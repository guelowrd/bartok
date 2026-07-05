import type { CosignerSignature, ConfigureRequest, ConfigureResponse, DeltaObject, DeltaProposalRequest, DeltaStatus, ExecutionDelta, LookupResponse, ProposalSignature, ProposalMetadata, SignProposalRequest, StateObject } from './types.js';
import type { ServerCosignerSignature, ServerConfigureRequest, ServerConfigureResponse, ServerDeltaObject, ServerDeltaProposalRequest, ServerDeltaStatus, ServerExecutionDelta, ServerLookupResponse, ServerProposalSignature, ServerProposalMetadata, ServerSignProposalRequest, ServerStateObject } from './server-types.js';
export declare function fromServerSignature(signature: ServerProposalSignature): ProposalSignature;
export declare function fromServerCosignerSignature(server: ServerCosignerSignature): CosignerSignature;
export declare function fromServerDeltaStatus(server: ServerDeltaStatus): DeltaStatus;
export declare function fromServerProposalMetadata(server: ServerProposalMetadata): ProposalMetadata;
export declare function fromServerDeltaObject(server: ServerDeltaObject): DeltaObject;
export declare function fromServerStateObject(server: ServerStateObject): StateObject;
export declare function fromServerConfigureResponse(server: ServerConfigureResponse): ConfigureResponse;
export declare function fromServerLookupResponse(server: ServerLookupResponse): LookupResponse;
export declare function toServerSignature(sig: ProposalSignature): ServerProposalSignature;
export declare function toServerCosignerSignature(sig: CosignerSignature): ServerCosignerSignature;
export declare function toServerDeltaStatus(status: DeltaStatus): ServerDeltaStatus;
export declare function toServerProposalMetadata(meta: ProposalMetadata): ServerProposalMetadata;
export declare function toServerConfigureRequest(req: ConfigureRequest): ServerConfigureRequest;
export declare function toServerDeltaProposalRequest(req: DeltaProposalRequest): ServerDeltaProposalRequest;
export declare function toServerSignProposalRequest(req: SignProposalRequest): ServerSignProposalRequest;
export declare function toServerExecutionDelta(delta: ExecutionDelta): ServerExecutionDelta;
//# sourceMappingURL=conversion.d.ts.map