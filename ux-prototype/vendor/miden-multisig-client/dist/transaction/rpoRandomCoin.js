import { Felt, FeltArray, Rpo256, } from '@miden-sdk/miden-sdk';
export class RpoRandomCoin {
    seed;
    constructor(seed) {
        this.seed = seed;
    }
    drawWord() {
        return Rpo256.hashElements(new FeltArray([
            ...this.seed.toFelts(),
            new Felt(0n),
            new Felt(0n),
            new Felt(0n),
            new Felt(0n),
        ]));
    }
}
//# sourceMappingURL=rpoRandomCoin.js.map