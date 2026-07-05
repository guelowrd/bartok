import { RequestAuthPayload } from './auth-request.js';
import { fromServerConfigureResponse, fromServerDeltaObject, fromServerLookupResponse, fromServerStateObject, toServerConfigureRequest, toServerDeltaProposalRequest, toServerExecutionDelta, toServerSignProposalRequest, } from './conversion.js';
/**
 * Error thrown by the GUARDIAN HTTP client.
 */
export class GuardianHttpError extends Error {
    status;
    statusText;
    body;
    constructor(status, statusText, body) {
        super(`GUARDIAN HTTP error ${status}: ${statusText} - ${body}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
        this.name = 'GuardianHttpError';
    }
}
/**
 * Minimal HTTP client for GUARDIAN server.
 */
export class GuardianHttpClient {
    signer = null;
    baseUrl;
    lastTimestamp = 0;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    /**
     * Monotonic timestamp for auth headers. Strictly increasing across calls
     * within a single client instance so concurrent or rapid-fire requests
     * never produce duplicate `x-timestamp` values.
     */
    nextTimestamp() {
        const now = Date.now();
        const ts = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
        this.lastTimestamp = ts;
        return ts;
    }
    setSigner(signer) {
        this.signer = signer;
    }
    async getPubkey(scheme) {
        const query = scheme ? `?scheme=${scheme}` : '';
        const response = await this.fetch(`/pubkey${query}`, { method: 'GET' });
        const data = (await response.json());
        return {
            commitment: data.commitment,
            pubkey: data.pubkey,
        };
    }
    async getStatus() {
        const response = await this.fetch('/status', { method: 'GET' });
        const data = (await response.json());
        return {
            status: data.status,
            version: data.version,
            gitCommit: data.git_commit,
            environment: data.environment,
            startedAt: data.started_at,
            uptimeSeconds: data.uptime_seconds,
        };
    }
    async configure(request) {
        const serverRequest = toServerConfigureRequest(request);
        const response = await this.fetchAuthenticated('/configure', {
            method: 'POST',
            body: JSON.stringify(serverRequest),
        }, request.accountId, serverRequest);
        const server = (await response.json());
        return fromServerConfigureResponse(server);
    }
    async getState(accountId) {
        const requestQuery = { account_id: accountId };
        const params = new URLSearchParams(requestQuery);
        const response = await this.fetchAuthenticated(`/state?${params}`, {
            method: 'GET',
        }, accountId, requestQuery);
        const server = (await response.json());
        return fromServerStateObject(server);
    }
    /**
     * Resolve a public-key commitment to the set of account IDs whose
     * authorization set contains it. Authentication is by proof-of-possession:
     * the configured signer MUST hold the private key behind `keyCommitmentHex`
     * and implement `signLookupMessage`. Returns an empty list when the
     * commitment is not authorized for any account.
     */
    async lookupAccountByKeyCommitment(keyCommitmentHex) {
        const params = new URLSearchParams({ key_commitment: keyCommitmentHex });
        const response = await this.fetchLookupAuthenticated(`/state/lookup?${params}`, { method: 'GET' }, keyCommitmentHex);
        return fromServerLookupResponse((await response.json()));
    }
    async getDeltaProposals(accountId) {
        const requestQuery = { account_id: accountId };
        const params = new URLSearchParams(requestQuery);
        const response = await this.fetchAuthenticated(`/delta/proposal?${params}`, {
            method: 'GET',
        }, accountId, requestQuery);
        const data = (await response.json());
        return data.proposals.map(fromServerDeltaObject);
    }
    async getDeltaProposal(accountId, commitment) {
        const requestQuery = { account_id: accountId, commitment };
        const params = new URLSearchParams(requestQuery);
        const response = await this.fetchAuthenticated(`/delta/proposal/single?${params}`, {
            method: 'GET',
        }, accountId, requestQuery);
        const data = (await response.json());
        return fromServerDeltaObject(data);
    }
    async pushDeltaProposal(request) {
        const serverRequest = toServerDeltaProposalRequest(request);
        const response = await this.fetchAuthenticated('/delta/proposal', {
            method: 'POST',
            body: JSON.stringify(serverRequest),
        }, request.accountId, serverRequest);
        const server = (await response.json());
        return {
            delta: fromServerDeltaObject(server.delta),
            commitment: server.commitment,
        };
    }
    async signDeltaProposal(request) {
        const serverRequest = toServerSignProposalRequest(request);
        const response = await this.fetchAuthenticated('/delta/proposal', {
            method: 'PUT',
            body: JSON.stringify(serverRequest),
        }, request.accountId, serverRequest);
        const server = (await response.json());
        return fromServerDeltaObject(server);
    }
    async pushDelta(delta) {
        const serverDelta = toServerExecutionDelta(delta);
        const response = await this.fetchAuthenticated('/delta', {
            method: 'POST',
            body: JSON.stringify(serverDelta),
        }, delta.accountId, serverDelta);
        const server = (await response.json());
        return {
            accountId: server.account_id,
            nonce: server.nonce,
            newCommitment: server.new_commitment,
            ackSig: server.ack_sig,
            ackPubkey: server.ack_pubkey,
            ackScheme: server.ack_scheme,
        };
    }
    async getDelta(accountId, nonce) {
        const requestPayload = {
            account_id: accountId,
            nonce,
        };
        const requestQuery = {
            account_id: accountId,
            nonce: nonce.toString(),
        };
        const params = new URLSearchParams(requestQuery);
        const response = await this.fetchAuthenticated(`/delta?${params}`, {
            method: 'GET',
        }, accountId, requestPayload);
        const server = (await response.json());
        return fromServerDeltaObject(server);
    }
    async getDeltaSince(accountId, fromNonce) {
        const requestPayload = {
            account_id: accountId,
            nonce: fromNonce,
        };
        const requestQuery = {
            account_id: accountId,
            nonce: fromNonce.toString(),
        };
        const params = new URLSearchParams(requestQuery);
        const response = await this.fetchAuthenticated(`/delta/since?${params}`, {
            method: 'GET',
        }, accountId, requestPayload);
        const server = (await response.json());
        return fromServerDeltaObject(server);
    }
    async fetch(path, init) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...init.headers,
            },
        });
        if (!response.ok) {
            const body = await response.text();
            throw new GuardianHttpError(response.status, response.statusText, body);
        }
        return response;
    }
    /**
     * Authenticated fetch for the lookup endpoint. Cannot reuse
     * `fetchAuthenticated`, which builds an `AuthRequestPayload` bound to an
     * `accountId` (the value lookup is trying to discover). Digest construction
     * is delegated to the signer's `signLookupMessage`.
     */
    async fetchLookupAuthenticated(path, init, keyCommitmentHex) {
        if (!this.signer) {
            throw new Error('No signer configured. Call setSigner() first.');
        }
        if (!this.signer.signLookupMessage) {
            throw new Error('Signer does not implement signLookupMessage. Account recovery by key requires a ' +
                'signer that produces signatures over LookupAuthMessage::to_word; the canonical ' +
                'helper lives in @openzeppelin/miden-multisig-client.');
        }
        const timestamp = this.nextTimestamp();
        const signature = await this.signer.signLookupMessage(keyCommitmentHex, timestamp);
        return this.fetch(path, {
            ...init,
            headers: {
                ...init.headers,
                // Sent for API consistency with per-account requests; the server's
                // lookup path derives the pubkey from the signature itself and
                // ignores this header for verification.
                'x-pubkey': this.signer.publicKey,
                'x-signature': signature,
                'x-timestamp': timestamp.toString(),
            },
        });
    }
    async fetchAuthenticated(path, init, accountId, requestPayload, retries = 2) {
        if (!this.signer) {
            throw new Error('No signer configured. Call setSigner() first.');
        }
        const timestamp = this.nextTimestamp();
        const authPayload = RequestAuthPayload.fromRequest(requestPayload);
        const signature = this.signer.signRequest
            ? await this.signer.signRequest(accountId, timestamp, authPayload)
            : await this.signer.signAccountIdWithTimestamp(accountId, timestamp);
        try {
            return await this.fetch(path, {
                ...init,
                headers: {
                    ...init.headers,
                    'x-pubkey': this.signer.publicKey,
                    'x-signature': signature,
                    'x-timestamp': timestamp.toString(),
                },
            });
        }
        catch (err) {
            if (retries > 0 && err instanceof GuardianHttpError && err.body.includes('Replay attack')) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                return this.fetchAuthenticated(path, init, accountId, requestPayload, retries - 1);
            }
            throw err;
        }
    }
}
//# sourceMappingURL=http.js.map