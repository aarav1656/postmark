type Listener = (event: unknown) => void;
const listeners = new Set<Listener>();
export const publish = (event: unknown) => listeners.forEach((listener) => listener(event));
export const subscribe = (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); };
