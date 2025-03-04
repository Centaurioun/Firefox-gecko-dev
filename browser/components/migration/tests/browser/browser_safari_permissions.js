/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { SafariProfileMigrator } = ChromeUtils.importESModule(
  "resource:///modules/SafariProfileMigrator.sys.mjs"
);

/**
 * Tests that if we don't have permission to read the contents
 * of ~/Library/Safari, that we can ask for permission to do that.
 *
 * This involves presenting the user with some instructions, and then
 * showing a native folder picker for the user to select the
 * ~/Library/Safari folder. This seems to give us read access to the
 * folder contents.
 *
 * Revoking permissions for reading the ~/Library/Safari folder is
 * not something that we know how to do just yet. It seems to be
 * something involving macOS's System Integrity Protection. This test
 * mocks out and simulates the actual permissions mechanism to make
 * this test run reliably and repeatably.
 */
add_task(async function test_safari_permissions() {
  let sandbox = sinon.createSandbox();
  registerCleanupFunction(() => {
    sandbox.restore();
  });

  let safariMigrator = new SafariProfileMigrator();
  sandbox.stub(MigrationUtils, "getMigrator").resolves(safariMigrator);

  sandbox
    .stub(SafariProfileMigrator.prototype, "hasPermissions")
    .onFirstCall()
    .resolves(false)
    .onSecondCall()
    .resolves(true);

  sandbox
    .stub(SafariProfileMigrator.prototype, "getPermissions")
    .resolves(true);

  sandbox
    .stub(SafariProfileMigrator.prototype, "getResources")
    .callsFake(() => {
      return Promise.resolve([
        {
          type: MigrationUtils.resourceTypes.BOOKMARKS,
          migrate: () => {},
        },
      ]);
    });

  let didMigration = new Promise(resolve => {
    sandbox
      .stub(SafariProfileMigrator.prototype, "migrate")
      .callsFake((aResourceTypes, aStartup, aProfile, aProgressCallback) => {
        Assert.ok(
          !aStartup,
          "Migrator should not have been called as a startup migration."
        );

        aProgressCallback(MigrationUtils.resourceTypes.BOOKMARKS);
        Services.obs.notifyObservers(null, "Migration:Ended");
        resolve();
      });
  });

  await withMigrationWizardDialog(async prefsWin => {
    let dialogBody = prefsWin.document.body;
    let wizard = dialogBody.querySelector("migration-wizard");
    let wizardDone = BrowserTestUtils.waitForEvent(
      wizard,
      "MigrationWizard:DoneMigration"
    );

    let shadow = wizard.openOrClosedShadowRoot;

    info("Choosing Safari");
    let panelItem = wizard.querySelector(
      `panel-item[key="${SafariProfileMigrator.key}"]`
    );
    panelItem.click();

    // Let's just choose "Bookmarks" for now.
    let resourceTypeList = shadow.querySelector("#resource-type-list");
    let node = resourceTypeList.querySelector(
      `label[data-resource-type="${MigrationWizardConstants.DISPLAYED_RESOURCE_TYPES.BOOKMARKS}"]`
    );
    node.control.checked = true;

    let deck = shadow.querySelector("#wizard-deck");
    let switchedToSafariPermissionPage = BrowserTestUtils.waitForMutationCondition(
      deck,
      { attributeFilter: ["selected-view"] },
      () => {
        return (
          deck.getAttribute("selected-view") ==
          "page-" + MigrationWizardConstants.PAGES.SAFARI_PERMISSION
        );
      }
    );

    let importButton = shadow.querySelector("#import");
    importButton.click();
    await switchedToSafariPermissionPage;
    Assert.ok(true, "Went to Safari permission page after attempting import.");

    let requestPermissions = shadow.querySelector(
      "#safari-request-permissions"
    );
    requestPermissions.click();
    await didMigration;
    Assert.ok(true, "Completed migration");

    let dialog = prefsWin.document.querySelector("#migrationWizardDialog");
    let doneButton = shadow.querySelector("#done-button");
    let dialogClosed = BrowserTestUtils.waitForEvent(dialog, "close");

    doneButton.click();
    await dialogClosed;
    await wizardDone;
  });
});
