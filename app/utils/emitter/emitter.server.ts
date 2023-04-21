import { EventEmitter } from "node:events";

let emitter: EventEmitter | undefined;
declare global {
  var emitter: EventEmitter | undefined;
}
if (!global.emitter) {
  global.emitter = new EventEmitter();
}
emitter = global.emitter;
export default emitter as EventEmitter;
