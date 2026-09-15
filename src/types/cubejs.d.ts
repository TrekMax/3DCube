declare module 'cubejs' {
  export default class Cube {
    constructor(state?: { cp: number[]; co: number[]; ep: number[]; eo: number[] });
    cp: number[];
    co: number[];
    ep: number[];
    eo: number[];
    static fromString(state: string): Cube;
    static random(): Cube;
    static initSolver(): void;
    static inverse(algorithm: string): string;
    asString(): string;
    move(algorithm: string): Cube;
    solve(maxDepth?: number): string;
    isSolved(): boolean;
  }
}
