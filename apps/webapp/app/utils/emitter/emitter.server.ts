/*
 * This file is used to create a global EventEmitter instance.
 * This is used to emit events from the action to the SSE route
 * so that the SSE route can send the event to the client.
 *
 * This example uses the EventEmitter class from the events built-in module.
 * You can use any other event emitter you want. For example, you can use
 * Redis or any PubSub technology to implement the same.
 *
 * In a real app, you would probably want to use one of those because your app
 * will probably be running on multiple servers.
 */
import { EventEmitter } from "node:events";

declare global {
  var emitter: EventEmitter;
}

if (!global.emitter) {
  global.emitter = new EventEmitter();
}

export const emitter = global.emitter;
