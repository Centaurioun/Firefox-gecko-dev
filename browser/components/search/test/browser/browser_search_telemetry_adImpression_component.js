/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  SearchSERPTelemetry,
  SearchSERPTelemetryUtils,
} = ChromeUtils.importESModule(
  "resource:///modules/SearchSERPTelemetry.sys.mjs"
);

const WINDOW_HEIGHT = 768;
const WINDOW_WIDTH = 1024;

const TEST_PROVIDER_INFO = [
  {
    telemetryId: "example",
    searchPageRegexp: /^http:\/\/mochi.test:.+\/browser\/browser\/components\/search\/test\/browser\/searchTelemetryAd_components_/,
    queryParamName: "s",
    codeParamName: "abc",
    taggedCodes: ["ff"],
    adServerAttributes: ["mozAttr"],
    extraAdServersRegexps: [/^https:\/\/example\.com\/ad$/],
    components: [
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
        included: {
          parent: {
            selector: ".moz-carousel",
          },
          children: [
            {
              selector: ".moz-carousel-card",
              countChildren: true,
            },
          ],
        },
        excluded: {
          regexps: [/^https:\/\/example\.com\/search\?(?:.+)&prs=/],
        },
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.REFINED_SEARCH_BUTTONS,
        included: {
          parent: {
            selector: ".moz-carousel",
          },
          children: [
            {
              selector: ".moz-carousel-text",
            },
          ],
          regexps: [/^https:\/\/example\.com\/search\?(?:.+)&prs=/],
        },
        nonAd: true,
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.REFINED_SEARCH_BUTTONS,
        included: {
          parent: {
            selector: ".moz-rich-suggestions",
          },
          children: [
            {
              selector: ".moz-suggestion a",
            },
          ],
        },
        nonAd: true,
        topDown: true,
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
        included: {
          parent: {
            selector: ".moz_ad",
          },
          children: [
            {
              selector: ".multi-col",
              type: SearchSERPTelemetryUtils.COMPONENTS.AD_SITELINK,
            },
          ],
        },
        excluded: {
          parent: {
            selector: ".rhs",
          },
        },
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.AD_SIDEBAR,
        included: {
          parent: {
            selector: ".rhs",
          },
        },
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.SHOPPING_TAB,
        included: {
          regexps: [/^https:\/\/example\.com\/search\?(?:.+)&page=shop/],
        },
        nonAd: true,
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.SHOPPING_TAB,
        included: {
          parent: {
            selector: "nav .list-item-shop a",
          },
        },
        topDown: true,
        nonAd: true,
      },
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
        included: {
          default: true,
        },
      },
    ],
  },
];

function getSERPUrl(page, organic = false) {
  let url =
    getRootDirectory(gTestPath).replace(
      "chrome://mochitests/content",
      "http://mochi.test:8888"
    ) + page;
  return `${url}?s=test${organic ? "" : "&abc=ff"}`;
}

async function promiseAdImpressionReceived() {
  return TestUtils.waitForCondition(() => {
    let adImpressions = Glean.serp.adImpression.testGetValue() ?? [];
    return adImpressions.length;
  }, "Should have received an ad impression.");
}

async function promiseResize(width, height) {
  return TestUtils.waitForCondition(() => {
    return window.outerWidth === width && window.outerHeight === height;
  }, "Waiting for window to resize");
}

// sharedData messages are only passed to the child on idle. Therefore
// we wait for a few idles to try and ensure the messages have been able
// to be passed across and handled.
async function waitForIdle() {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => Services.tm.idleDispatchToMainThread(resolve));
  }
}

add_setup(async function() {
  SearchSERPTelemetry.overrideSearchTelemetryForTests(TEST_PROVIDER_INFO);
  await waitForIdle();
  // Enable local telemetry recording for the duration of the tests.
  let oldCanRecord = Services.telemetry.canRecordExtended;
  Services.telemetry.canRecordExtended = true;
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.search.log", true],
      ["browser.search.serpEventTelemetry.enabled", true],
    ],
  });

  // The tests evaluate whether or not ads are visible depending on whether
  // they are within the view of the window. To ensure the test results
  // are consistent regardless of where they are launched,
  // set the window size to something reasonable.
  let originalWidth = window.outerWidth;
  let originalHeight = window.outerHeight;
  window.resizeTo(WINDOW_WIDTH, WINDOW_HEIGHT);
  await promiseResize(WINDOW_WIDTH, WINDOW_HEIGHT);

  registerCleanupFunction(async () => {
    SearchSERPTelemetry.overrideSearchTelemetryForTests();
    Services.telemetry.canRecordExtended = oldCanRecord;
    window.resizeTo(originalWidth, originalHeight);
    await promiseResize(originalWidth, originalHeight);
    resetTelemetry();
  });
});

add_task(async function test_ad_impressions_with_one_carousel() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_carousel.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
      ads_loaded: "4",
      ads_visible: "3",
      ads_hidden: "0",
    },
  ]);

  BrowserTestUtils.removeTab(tab);
});

// This is to ensure we're not counting two carousel components as two
// separate components but as one record with a sum of the results.
add_task(async function test_ad_impressions_with_two_carousels() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_carousel_doubled.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  // This is to ensure we've seen the other carousel regardless the
  // size of the browser window.
  await SpecialPowers.spawn(gBrowser.selectedBrowser, [], () => {
    let el = content.document
      .getElementById("second-ad")
      .getBoundingClientRect();
    // The 100 is just to guarantee we've scrolled past the element.
    content.scrollTo(0, el.top + el.height + 100);
  });

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
      ads_loaded: "8",
      ads_visible: "6",
      ads_hidden: "0",
    },
  ]);

  BrowserTestUtils.removeTab(tab);
});

add_task(
  async function test_ad_impressions_with_carousels_with_outer_container() {
    resetTelemetry();
    let url = getSERPUrl(
      "searchTelemetryAd_components_carousel_outer_container.html"
    );
    let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

    await promiseAdImpressionReceived();

    assertAdImpressionEvents([
      {
        component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
        ads_loaded: "4",
        ads_visible: "3",
        ads_hidden: "0",
      },
    ]);

    BrowserTestUtils.removeTab(tab);
  }
);

add_task(async function test_ad_impressions_with_carousels_tabhistory() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_carousel.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  // Reset telemetry because we care about the telemetry upon going back.
  resetTelemetry();

  let browserLoadedPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  BrowserTestUtils.loadURIString(
    tab.linkedBrowser,
    "https://www.example.com/some_url"
  );
  await browserLoadedPromise;

  let pageShowPromise = BrowserTestUtils.waitForContentEvent(
    tab.linkedBrowser,
    "pageshow"
  );
  tab.linkedBrowser.goBack();
  await pageShowPromise;

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
      ads_loaded: "4",
      ads_visible: "3",
      ads_hidden: "0",
    },
  ]);

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ad_impressions_with_hidden_carousels() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_carousel_hidden.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
      ads_loaded: "3",
      ads_visible: "0",
      ads_hidden: "3",
    },
  ]);

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ad_impressions_with_carousel_scrolled_left() {
  resetTelemetry();
  let url = getSERPUrl(
    "searchTelemetryAd_components_carousel_first_element_non_visible.html"
  );
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
      ads_loaded: "4",
      ads_visible: "2",
      ads_hidden: "0",
    },
  ]);

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ad_impressions_with_carousel_below_the_fold() {
  resetTelemetry();
  let url = getSERPUrl(
    "searchTelemetryAd_components_carousel_below_the_fold.html"
  );
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_CAROUSEL,
      ads_loaded: "4",
      ads_visible: "0",
      ads_hidden: "0",
    },
  ]);

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ad_impressions_with_text_links() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_text.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_SITELINK,
      ads_loaded: "1",
      ads_visible: "1",
      ads_hidden: "0",
    },
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
      ads_loaded: "2",
      ads_visible: "2",
      ads_hidden: "0",
    },
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_SIDEBAR,
      ads_loaded: "1",
      ads_visible: "1",
      ads_hidden: "0",
    },
  ]);
  BrowserTestUtils.removeTab(tab);
});

// An ad is considered visible if at least one link is within the viewable
// content area when the impression was taken. Since the user can scroll
// the page before ad impression is recorded, we should ensure that an
// ad that was scrolled onto the screen before the impression is taken is
// properly recorded. Additionally, some ads might have a large content
// area that extends beyond the viewable area, but as long as a single
// ad link was viewable within the area, we should count the ads as visible.
add_task(async function test_ad_visibility() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_visibility.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await SpecialPowers.spawn(gBrowser.selectedBrowser, [], () => {
    let el = content.document
      .getElementById("second-ad")
      .getBoundingClientRect();
    // The 100 is just to guarantee we've scrolled past the element.
    content.scrollTo(0, el.top + el.height + 100);
  });

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
      ads_loaded: "6",
      ads_visible: "4",
      ads_hidden: "0",
    },
  ]);
  BrowserTestUtils.removeTab(tab);
});

// Refinement buttons won't be detected unless there is at least
// one ad on the page. There are two instances of the shopping tab on this page:
// one using a bottom up approach with regular expressions and the other using
// a top down approach via the document object.
add_task(async function test_ad_impressions_with_refined_search_button() {
  resetTelemetry();
  let url = getSERPUrl(
    "searchTelemetryAd_components_refined_search_button.html"
  );
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.REFINED_SEARCH_BUTTONS,
      ads_loaded: "2",
      ads_visible: "2",
      ads_hidden: "0",
    },
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
      ads_loaded: "1",
      ads_visible: "1",
      ads_hidden: "0",
    },
  ]);
  BrowserTestUtils.removeTab(tab);
});

// Shopping tabs won't be detected unless there is at least one
// ad on the page. There are two instances of the shopping tab on this page:
// one using a bottom up approach with regular expressions and the other using
// a top down approach via the document object.
add_task(async function test_ad_impressions_with_shop_tab() {
  resetTelemetry();
  let url = getSERPUrl("searchTelemetryAd_components_shopping_tab.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);

  await promiseAdImpressionReceived();

  assertAdImpressionEvents([
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.SHOPPING_TAB,
      ads_loaded: "2",
      ads_visible: "2",
      ads_hidden: "0",
    },
    {
      component: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
      ads_loaded: "1",
      ads_visible: "1",
      ads_hidden: "0",
    },
  ]);
  BrowserTestUtils.removeTab(tab);
});
