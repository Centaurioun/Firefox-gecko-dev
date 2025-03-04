/**
 * Bug 531915 - A test for verifying that the JS Math fingerprint is constant
 *              when using fdlibm for Math.sin, Math.cos, and Math.tan.
 */

async function test_math(rfp_pref, fdlibm_pref) {
  info(
    `privacy.resistFingerprinting: ${rfp_pref} javascript.options.use_fdlibm_for_sin_cos_tan: ${fdlibm_pref}`
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["javascript.options.use_fdlibm_for_sin_cos_tan", fdlibm_pref],
      ["privacy.resistFingerprinting", rfp_pref],
    ],
  });

  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    TEST_PATH + "file_dummy.html"
  );

  await SpecialPowers.spawn(tab.linkedBrowser, [], async function() {
    function test() {
      /* eslint-disable */
      //
      // Tests adapted from https://github.com/arkenfox/TZP/blob/5e3f5ff2c64b4edc7beecd8308aa4f7a3efb49e3/tests/math.html#L158-L319
      //
      is(Math.cos(1e251), -0.37419577499634155, "Math.cos(1e251)");
      is(Math.cos(1e140), -0.7854805190645291, "Math.cos(1e140)");
      is(Math.cos(1e12), 0.7914463018528902, "Math.cos(1e12)");
      is(Math.cos(1e130), -0.767224894221913, "Math.cos(1e130)");
      is(Math.cos(1e272), -0.7415825695514536, "Math.cos(1e272)");
      is(Math.cos(1), 0.5403023058681398, "Math.cos(1)");
      is(Math.cos(1e284), 0.7086865671674247, "Math.cos(1e284)");
      is(Math.cos(1e75), -0.7482651726250321, "Math.cos(1e75)");
      is(Math.cos(Math.PI), -1, "Math.cos(Math.PI)");
      is(Math.cos(-1e308), -0.8913089376870335, "Math.cos(-1e308)");
      is(Math.cos(13 * Math.E), -0.7108118501064332, "Math.cos(13 * Math.E)");
      is(Math.cos(57 * Math.E), -0.536911695749024, "Math.cos(57 * Math.E)");
      is(Math.cos(21 * Math.LN2), -0.4067775970251724, "Math.cos(21 * Math.LN2)");
      is(Math.cos(51 * Math.LN2), -0.7017203400855446, "Math.cos(51 * Math.LN2)");
      is(Math.cos(21 * Math.LOG2E), 0.4362848063618998, "Math.cos(21 * Math.LOG2E)");
      is(Math.cos(25 * Math.SQRT2), -0.6982689820462377, "Math.cos(25 * Math.SQRT2)");
      is(Math.cos(50 * Math.SQRT1_2), -0.6982689820462377, "Math.cos(50 * Math.SQRT1_2)");
      is(Math.cos(21 * Math.SQRT1_2), -0.6534063185820198, "Math.cos(21 * Math.SQRT1_2)");
      is(Math.cos(17 * Math.LOG10E), 0.4537557425982784, "Math.cos(17 * Math.LOG10E)");
      is(Math.cos(2 * Math.LOG10E), 0.6459044007438142, "Math.cos(2 * Math.LOG10E)");

      is(Math.sin(1e251), -0.9273497301314576, "Math.sin(1e251)");
      is(Math.sin(1e140), -0.6188863822787813, "Math.sin(1e140)");
      is(Math.sin(1e12), -0.6112387023768895, "Math.sin(1e12)");
      is(Math.sin(1e130), 0.6413781736901984, "Math.sin(1e130)");
      is(Math.sin(1e272), 0.6708616046081811, "Math.sin(1e272)");
      is(Math.sin(1), 0.8414709848078965, "Math.sin(1)");
      is(Math.sin(1e284), -0.7055234578073583, "Math.sin(1e284)");
      is(Math.sin(1e75), 0.66339975236386, "Math.sin(1e75)");
      is(Math.sin(Math.PI), 1.2246467991473532e-16, "Math.sin(Math.PI)");
      is(Math.sin(39 * Math.E), -0.7181630308570678, "Math.sin(39 * Math.E)");
      is(Math.sin(35 * Math.LN2), -0.765996413898051, "Math.sin(35 * Math.LN2)");
      is(Math.sin(110 * Math.LOG2E), 0.9989410140273757, "Math.sin(110 * Math.LOG2E)");
      is(Math.sin(7 * Math.LOG10E), 0.10135692924965616, "Math.sin(7 * Math.LOG10E)");
      is(Math.sin(35 * Math.SQRT1_2), -0.3746357547858202, "Math.sin(35 * Math.SQRT1_2)");
      is(Math.sin(21 * Math.SQRT2), -0.9892668187780497, "Math.sin(21 * Math.SQRT2)");

      is(Math.tan(1e251), 2.478247463217681, "Math.tan(1e251)");
      is(Math.tan(1e140), 0.7879079967710036, "Math.tan(1e140)");
      is(Math.tan(1e12), -0.7723059681318761, "Math.tan(1e12)");
      is(Math.tan(1e130), -0.8359715365344825, "Math.tan(1e130)");
      is(Math.tan(1e272), -0.904635076595654, "Math.tan(1e272)");
      is(Math.tan(1), 1.5574077246549023, "Math.tan(1)");
      is(Math.tan(1e284), -0.9955366596368418, "Math.tan(1e284)");
      is(Math.tan(1e75), -0.8865837628611647, "Math.tan(1e75)");
      is(Math.tan(-1e308), 0.5086861259107568, "Math.tan(-1e308)");
      is(Math.tan(Math.PI), -1.2246467991473532e-16, "Math.tan(Math.PI)");
      is(Math.tan(6 * Math.E), 0.6866761546452431, "Math.tan(6 * Math.E)");
      is(Math.tan(6 * Math.LN2), 1.6182817135715877, "Math.tan(6 * Math.LN2)");
      is(Math.tan(10 * Math.LOG2E), -3.3537128705376014, "Math.tan(10 * Math.LOG2E)");
      is(Math.tan(17 * Math.SQRT2), -1.9222955461799982, "Math.tan(17 * Math.SQRT2)");
      is(Math.tan(34 * Math.SQRT1_2), -1.9222955461799982, "Math.tan(34 * Math.SQRT1_2)");
      is(Math.tan(10 * Math.LOG10E), 2.5824856130712432, "Math.tan(10 * Math.LOG10E)");

      //
      // Tests adapted from https://github.com/fingerprintjs/fingerprintjs/blob/7096a5589af495f1f46067963e13ad27d887d185/src/sources/math.ts#L32-L64
      //
      is(Math.acos(0.123124234234234242), 1.4473588658278522, "Math.acos(0.123124234234234242)");
      is(Math.acosh(1e308), 709.889355822726, "Math.acosh(1e308)");
      is(Math.asin(0.123124234234234242), 0.12343746096704435, "Math.asin(0.123124234234234242)");
      is(Math.asinh(1), 0.881373587019543, "Math.asinh(1)");
      is(Math.atanh(0.5), 0.5493061443340548, "Math.atanh(0.5)");
      is(Math.atan(0.5), 0.4636476090008061, "Math.atan(0.5)");
      is(Math.sin(-1e300), 0.8178819121159085, "Math.sin(-1e300)");
      is(Math.sinh(1), 1.1752011936438014, "Math.sinh(1)");
      is(Math.cos(10.000000000123), -0.8390715290095377, "Math.cos(10.000000000123)");
      is(Math.cosh(1), 1.5430806348152437, "Math.cosh(1)");
      is(Math.tan(-1e300), -1.4214488238747245, "Math.tan(-1e300)");
      is(Math.tanh(1), 0.7615941559557649, "Math.tanh(1)");
      is(Math.exp(1), 2.718281828459045, "Math.exp(1)");
      is(Math.expm1(1), 1.718281828459045, "Math.expm1(1)");
      is(Math.log1p(10), 2.3978952727983707, "Math.log1p(10)");
      /* eslint-enable */
    }

    // Run test in the context of the page.
    Cu.exportFunction(is, content, { defineAs: "is" });
    content.eval(`(${test})()`);
  });

  BrowserTestUtils.removeTab(tab);

  await SpecialPowers.popPrefEnv();
}

add_task(test_math.bind(null, false, true));
add_task(test_math.bind(null, true, false));
add_task(test_math.bind(null, true, true));
