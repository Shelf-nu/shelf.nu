export type VoidOrPromiseFunction = () => void | Promise<void>;

export const noop: VoidOrPromiseFunction = () => {};
