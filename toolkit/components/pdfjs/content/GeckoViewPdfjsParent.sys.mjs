/* Copyright 2022 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GeckoViewActorParent } from "resource://gre/modules/GeckoViewActorParent.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

class FindHandler {
  #browser;

  #callbacks = null;

  #state = null;

  constructor(aBrowser) {
    this.#browser = aBrowser;
  }

  cleanup() {
    this.#state = null;
    this.#callbacks = null;
  }

  onEvent(aEvent, aData, aCallback) {
    if (
      this.#browser.contentPrincipal.spec !==
      "resource://pdf.js/web/viewer.html"
    ) {
      return;
    }

    debug`onEvent: name=${aEvent}, data=${aData}`;

    switch (aEvent) {
      case "GeckoView:ClearMatches":
        this.cleanup();
        this.#browser.sendMessageToActor(
          "PDFJS:Child:handleEvent",
          {
            type: "findbarclose",
            detail: null,
          },
          "GeckoViewPdfjs"
        );
        break;
      case "GeckoView:DisplayMatches":
        if (!this.#state) {
          return;
        }
        this.#browser.sendMessageToActor(
          "PDFJS:Child:handleEvent",
          {
            type: "findhighlightallchange",
            detail: this.#state,
          },
          "GeckoViewPdfjs"
        );
        break;
      case "GeckoView:FindInPage":
        const type = this.#getFindType(aData);
        this.#browser.sendMessageToActor(
          "PDFJS:Child:handleEvent",
          {
            type,
            detail: this.#state,
          },
          "GeckoViewPdfjs"
        );
        this.#callbacks.push([aCallback, this.#state]);
        break;
    }
  }

  #getFindType(aData) {
    const newState = {
      query: this.#state?.query,
      caseSensitive: !!aData.matchCase,
      entireWord: !!aData.wholeWord,
      highlightAll: !!aData.highlightAll,
      findPrevious: !!aData.backwards,
      matchDiacritics: !!aData.matchDiacritics,
    };
    if (!this.#state) {
      // It's a new search.
      newState.query = aData.searchString;
      this.#state = newState;
      this.#callbacks = [];
      return "find";
    }

    if (aData.searchString && this.#state.query !== aData.searchString) {
      // The searched string has changed.
      newState.query = aData.searchString;
      this.#state = newState;
      return "find";
    }

    for (const [key, type] of [
      ["caseSensitive", "findcasesensitivitychange"],
      ["entireWord", "findentirewordchange"],
      ["matchDiacritics", "finddiacriticmatchingchange"],
    ]) {
      if (this.#state[key] !== newState[key]) {
        this.#state = newState;
        return type;
      }
    }

    this.#state = newState;
    return "findagain";
  }

  updateMatchesCount(aData, aResult) {
    if (
      (aResult !== Ci.nsITypeAheadFind.FIND_FOUND &&
        aResult !== Ci.nsITypeAheadFind.FIND_WRAPPED) ||
      !this.#state
    ) {
      return;
    }

    if (this.#callbacks.length === 0) {
      warn`There are no callbacks to use to set the matches count.`;
      return;
    }

    const [callback, state] = this.#callbacks.shift();

    aData ||= { current: 0, total: -1 };

    const response = {
      found: aData.total !== 0,
      wrapped:
        aData.total === 0 || aResult === Ci.nsITypeAheadFind.FIND_WRAPPED,
      current: aData.current,
      total: aData.total,
      searchString: state.query,
      linkURL: null,
      clientRect: null,
      flags: {
        backwards: state.findPrevious,
        matchCase: state.caseSensitive,
        wholeWord: state.entireWord,
      },
    };
    callback.onSuccess(response);
  }
}

class FileSaver {
  #browser;

  #callback = null;

  #eventDispatcher;

  constructor(aBrowser, eventDispatcher) {
    this.#browser = aBrowser;
    this.#eventDispatcher = eventDispatcher;
  }

  cleanup() {
    this.#callback = null;
  }

  onEvent(aEvent, aData, aCallback) {
    if (
      this.#browser.contentPrincipal.spec !==
      "resource://pdf.js/web/viewer.html"
    ) {
      return;
    }

    this.#callback = aCallback;
    this.#browser.sendMessageToActor(
      "PDFJS:Child:handleEvent",
      {
        type: "save",
      },
      "GeckoViewPdfjs"
    );
  }

  async save({ blobUrl, filename, originalUrl }) {
    try {
      const isPrivate = lazy.PrivateBrowsingUtils.isBrowserPrivate(
        this.#browser
      );
      const response = await fetch(blobUrl);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (this.#callback) {
        this.#callback.onSuccess({
          bytes,
          filename,
          originalUrl,
          isPrivate,
        });
      } else {
        this.#eventDispatcher.sendRequest({
          type: "GeckoView:SavePdf",
          bytes,
          filename,
          originalUrl,
          isPrivate,
        });
      }
      debug`Save a PDF: ${bytes.length} bytes sent.`;
    } catch (e) {
      if (this.#callback) {
        this.#callback?.onError(`Cannot save the pdf: ${e}.`);
      } else {
        warn`Cannot save the pdf because of: ${e}`;
      }
    } finally {
      this.cleanup();
    }
  }
}

export class GeckoViewPdfjsParent extends GeckoViewActorParent {
  #findHandler;

  #fileSaver;

  receiveMessage(aMsg) {
    debug`receiveMessage: name=${aMsg.name}, data=${aMsg.data}`;

    switch (aMsg.name) {
      case "PDFJS:Parent:updateControlState":
        return this.#updateControlState(aMsg);
      case "PDFJS:Parent:updateMatchesCount":
        return this.#updateMatchesCount(aMsg);
      case "PDFJS:Parent:addEventListener":
        return this.#addEventListener();
      case "PDFJS:Parent:saveURL":
        return this.#save(aMsg);
      default:
        break;
    }

    return undefined;
  }

  didDestroy() {
    debug`didDestroy`;

    if (!this.#findHandler) {
      return;
    }

    this.eventDispatcher.unregisterListener(this.#findHandler, [
      "GeckoView:ClearMatches",
      "GeckoView:DisplayMatches",
      "GeckoView:FindInPage",
    ]);
    this.#findHandler.cleanup();
    this.#findHandler = null;

    this.eventDispatcher.unregisterListener(this.#fileSaver, [
      "GeckoView:PDFSave",
    ]);
    this.#fileSaver.cleanup();
    this.#fileSaver = null;
  }

  #addEventListener() {
    if (this.#findHandler) {
      this.#findHandler.cleanup();
      return;
    }

    this.#findHandler = new FindHandler(this.browser);
    this.eventDispatcher.registerListener(this.#findHandler, [
      "GeckoView:ClearMatches",
      "GeckoView:DisplayMatches",
      "GeckoView:FindInPage",
    ]);

    this.#fileSaver = new FileSaver(this.browser, this.eventDispatcher);
    this.eventDispatcher.registerListener(this.#fileSaver, [
      "GeckoView:PDFSave",
    ]);
  }

  #updateMatchesCount({ data }) {
    this.#findHandler.updateMatchesCount(data, Ci.nsITypeAheadFind.FIND_FOUND);
  }

  #updateControlState({ data: { matchesCount, result } }) {
    this.#findHandler.updateMatchesCount(matchesCount, result);
  }

  #save({ data }) {
    this.#fileSaver.save(data);
  }
}

const { debug, warn } = GeckoViewPdfjsParent.initLogging(
  "GeckoViewPdfjsParent"
);
