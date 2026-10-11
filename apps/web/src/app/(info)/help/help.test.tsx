import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HelpPage from "./page";
import InfoLayout from "../layout";
import PrivacyPage from "../privacy/page";
import SecurityPage from "../security/page";
import TermsPage from "../terms/page";

describe("public help and preview trust boundaries", () => {
  it("offers keyboard-native questions with real destination links and valid topic anchors", () => {
    const { container } = render(<InfoLayout><HelpPage /></InfoLayout>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("A little help");
    const questions = container.querySelectorAll("details");
    expect(questions.length).toBe(13);
    for (const question of questions) {
      expect(question.querySelector("summary")).not.toBeNull();
      expect(question.querySelector("a")?.getAttribute("href")).toMatch(/^\//);
    }
    for (const link of within(screen.getByRole("navigation", { name: "FAQ topics" })).getAllByRole("link")) {
      expect(container.querySelector(link.getAttribute("href")!)).not.toBeNull();
    }
    expect(screen.getByLabelText("Preview limits")).toHaveTextContent("synthetic sample data only");
    expect(screen.getByLabelText("Preview limits")).toHaveTextContent("disabled");
  });
  it.each([
    [PrivacyPage, "not a complete privacy policy"],
    [SecurityPage, "not proof"],
    [TermsPage, "not a reviewed legal agreement"],
  ])("shows limitations before status details", (Page, boundary) => {
    const { container } = render(<InfoLayout><Page /></InfoLayout>);
    expect(screen.getByRole("main")).toHaveTextContent(boundary);
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Help and trust" })).toBeVisible();
  });
});
