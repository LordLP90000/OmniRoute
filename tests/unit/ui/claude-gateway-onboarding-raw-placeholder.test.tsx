// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ClaudeGatewayOnboardingBlock from "../../../src/app/(dashboard)/dashboard/cli-code/components/ClaudeGatewayOnboardingBlock";

// next-intl: no local mock — falls through to the real-EN-text default mock in
// tests/_setup/vitestUiPolyfills.ts. That matters here: `cliTools.ccOnboardingKeyPlaceholder`
// is the literal "<your OmniRoute API key>", and use-intl's development build (what vitest
// and `next dev` resolve) compiles any message containing "<" — so plain `t()` fails with
// INVALID_MESSAGE: INVALID_TAG and renders the dotted fallback key into the snippet.
// The component must read the placeholder via `t.raw()` instead.
describe("ClaudeGatewayOnboardingBlock placeholder", () => {
  it("renders the literal <...> key placeholder, not an INVALID_TAG fallback key", () => {
    const html = renderToStaticMarkup(
      <ClaudeGatewayOnboardingBlock baseUrl="http://localhost:20128" />
    );

    // The snippet must contain the raw placeholder from en.json (HTML-escaped by React).
    expect(html).toContain("&lt;your OmniRoute API key&gt;");

    // And never the dotted fallback key that next-intl renders when message parsing fails.
    expect(html).not.toContain("ccOnboardingKeyPlaceholder");
  });
});
