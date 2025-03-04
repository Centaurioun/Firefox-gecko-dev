/* vim: set ts=2 sw=2 sts=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  MESSAGE_TYPE_LIST,
  MESSAGE_TYPE_HASH as msg,
} from "resource://activity-stream/common/ActorConstants.sys.mjs";

const VALID_TYPES = new Set(MESSAGE_TYPE_LIST);

export class ASRouterChild extends JSWindowActorChild {
  constructor() {
    super();
    this.observers = new Set();
    this.rpmInitialized = false;
  }

  didDestroy() {
    this.observers.clear();
  }

  actorCreated() {
    // NOTE: DOMDocElementInserted may be called multiple times per
    // PWindowGlobal due to the initial about:blank document's window global
    // being re-used.
    this.initializeRPM();
    const window = this.contentWindow;
    Cu.exportFunction(this.asRouterMessage.bind(this), window, {
      defineAs: "ASRouterMessage",
    });
    Cu.exportFunction(this.addParentListener.bind(this), window, {
      defineAs: "ASRouterAddParentListener",
    });
    Cu.exportFunction(this.removeParentListener.bind(this), window, {
      defineAs: "ASRouterRemoveParentListener",
    });
  }

  handleEvent(event) {
    // DOMDocElementCreated is only used to create the actor.
  }

  addParentListener(listener) {
    this.observers.add(listener);
  }

  removeParentListener(listener) {
    this.observers.delete(listener);
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "EnterSnippetsPreviewMode":
      case "UpdateAdminState":
      case "ClearProviders":
      case "ClearMessages": {
        this.observers.forEach(listener => {
          let result = Cu.cloneInto(
            {
              type: name,
              data,
            },
            this.contentWindow
          );
          listener(result);
        });
        break;
      }
    }
  }

  wrapPromise(promise) {
    return new this.contentWindow.Promise((resolve, reject) =>
      promise.then(resolve, reject)
    );
  }

  sendQuery(aName, aData = null) {
    return this.wrapPromise(
      new Promise(resolve => {
        super.sendQuery(aName, aData).then(result => {
          resolve(Cu.cloneInto(result, this.contentWindow));
        });
      })
    );
  }

  asRouterMessage({ type, data }) {
    if (VALID_TYPES.has(type)) {
      switch (type) {
        case msg.DISABLE_PROVIDER:
        case msg.ENABLE_PROVIDER:
        case msg.EXPIRE_QUERY_CACHE:
        case msg.FORCE_WHATSNEW_PANEL:
        case msg.CLOSE_WHATSNEW_PANEL:
        case msg.FORCE_PRIVATE_BROWSING_WINDOW:
        case msg.IMPRESSION:
        case msg.RESET_PROVIDER_PREF:
        case msg.SET_PROVIDER_USER_PREF:
        case msg.USER_ACTION: {
          return this.sendAsyncMessage(type, data);
        }
        default: {
          // these messages need a response
          return this.sendQuery(type, data);
        }
      }
    }
    throw new Error(`Unexpected type "${type}"`);
  }

  // Creates a new PageListener for this process. This will listen for page loads
  // and for those that match URLs provided by the parent process will set up
  // a dedicated message port and notify the parent process.
  // Note: this is part of the old message-manager based RPM and is only still
  // used by newtab/home/welcome.
  initializeRPM() {
    if (this.rpmInitialized) {
      return;
    }

    // Strip the hash from the URL, because it's not part of the origin.
    let url = this.document.documentURI.replace(/[\#?].*$/, "");

    let registeredURLs = Services.cpmm.sharedData.get("RemotePageManager:urls");

    if (registeredURLs && registeredURLs.has(url)) {
      let { ChildMessagePort } = ChromeUtils.importESModule(
        "resource://gre/modules/remotepagemanager/RemotePageManagerChild.sys.mjs"
      );
      // Set up the child side of the message port
      // eslint-disable-next-line no-new
      new ChildMessagePort(this.contentWindow);
      this.rpmInitialized = true;
    }
  }
}
