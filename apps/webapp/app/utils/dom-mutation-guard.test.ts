/* eslint-disable no-console -- the guard reports through console.warn; the tests assert on it */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installDomMutationGuard,
  isDomMutationGuardInstalled,
  uninstallDomMutationGuard,
} from "./dom-mutation-guard";

/**
 * Rewrites a text node the way Chrome's page translation does: the original
 * node is detached and a `<font><font>translated</font></font>` wrapper takes
 * its place.
 */
function translateTextNode(text: Text): HTMLElement {
  const outer = document.createElement("font");
  const inner = document.createElement("font");
  inner.textContent = `translated: ${text.nodeValue}`;
  outer.appendChild(inner);
  text.parentNode!.replaceChild(outer, text);
  return outer;
}

/**
 * Moves a text node into a wrapper element in place, the way an extension
 * that decorates text (rather than replacing it) rewrites the DOM.
 */
function reparentTextNode(text: Text): HTMLElement {
  const wrapper = document.createElement("mark");
  text.parentNode!.replaceChild(wrapper, text);
  wrapper.appendChild(text);
  return wrapper;
}

describe("installDomMutationGuard", () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  afterEach(() => {
    uninstallDomMutationGuard();
    parent.remove();
    vi.restoreAllMocks();
  });

  it("throws NotFoundError without the guard when the child was rewritten", () => {
    const text = document.createTextNode("Select user role");
    parent.appendChild(text);
    translateTextNode(text);

    expect(() => parent.removeChild(text)).toThrow();
  });

  describe("removeChild", () => {
    beforeEach(() => {
      installDomMutationGuard();
    });

    it("removes a real child through the native method", () => {
      const child = document.createElement("span");
      parent.appendChild(child);

      expect(parent.removeChild(child)).toBe(child);
      expect(parent.contains(child)).toBe(false);
    });

    it("returns the node without throwing when it was rewritten by translation", () => {
      const text = document.createTextNode("Select user role");
      parent.appendChild(text);
      const wrapper = translateTextNode(text);

      expect(parent.removeChild(text)).toBe(text);
      expect(parent.firstChild).toBe(wrapper);
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("warns once per method, not once per call", () => {
      const a = document.createTextNode("a");
      const b = document.createTextNode("b");
      parent.append(a, b);
      translateTextNode(a);
      translateTextNode(b);

      parent.removeChild(a);
      parent.removeChild(b);

      expect(console.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("insertBefore", () => {
    beforeEach(() => {
      installDomMutationGuard();
    });

    it("inserts before a real reference through the native method", () => {
      const first = document.createElement("i");
      const last = document.createElement("b");
      parent.append(first, last);
      const inserted = document.createElement("u");

      expect(parent.insertBefore(inserted, last)).toBe(inserted);
      expect([...parent.childNodes]).toEqual([first, inserted, last]);
    });

    it("appends when the reference is null", () => {
      const first = document.createElement("i");
      parent.append(first);
      const inserted = document.createElement("u");

      parent.insertBefore(inserted, null);

      expect([...parent.childNodes]).toEqual([first, inserted]);
    });

    it("appends when the reference was replaced by translation", () => {
      const first = document.createElement("i");
      const text = document.createTextNode("Select user role");
      parent.append(first, text);
      const wrapper = translateTextNode(text);
      const inserted = document.createElement("u");

      parent.insertBefore(inserted, text);

      expect([...parent.childNodes]).toEqual([first, wrapper, inserted]);
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("inserts before the wrapper when the reference was moved into one", () => {
      const first = document.createElement("i");
      const text = document.createTextNode("Select user role");
      const last = document.createElement("b");
      parent.append(first, text, last);
      const wrapper = reparentTextNode(text);
      const inserted = document.createElement("u");

      parent.insertBefore(inserted, text);

      expect([...parent.childNodes]).toEqual([first, inserted, wrapper, last]);
    });

    it("appends when the reference is detached from the document", () => {
      const first = document.createElement("i");
      const reference = document.createElement("s");
      parent.append(first, reference);
      reference.remove();
      const inserted = document.createElement("u");

      parent.insertBefore(inserted, reference);

      expect([...parent.childNodes]).toEqual([first, inserted]);
    });
  });

  describe("lifecycle", () => {
    it("installs once and restores the native methods on uninstall", () => {
      const nativeRemoveChild = Node.prototype.removeChild;
      const nativeInsertBefore = Node.prototype.insertBefore;

      installDomMutationGuard();
      const guardedRemoveChild = Node.prototype.removeChild;
      installDomMutationGuard();

      expect(isDomMutationGuardInstalled()).toBe(true);
      expect(Node.prototype.removeChild).toBe(guardedRemoveChild);
      expect(Node.prototype.removeChild).not.toBe(nativeRemoveChild);

      uninstallDomMutationGuard();

      expect(isDomMutationGuardInstalled()).toBe(false);
      expect(Node.prototype.removeChild).toBe(nativeRemoveChild);
      expect(Node.prototype.insertBefore).toBe(nativeInsertBefore);
    });

    it("installs nothing when given no prototype", () => {
      expect(installDomMutationGuard(null)).toBeTypeOf("function");
      expect(isDomMutationGuardInstalled()).toBe(false);
    });
  });
});
