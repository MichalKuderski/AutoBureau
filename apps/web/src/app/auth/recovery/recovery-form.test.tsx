import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecoveryForm } from "./recovery-form";
import { ForgotPasswordForm } from "../../(auth)/forgot-password/forgot-password-form";

afterEach(() => vi.unstubAllGlobals());
describe("recovery request", () => {
  it("is honestly unavailable unless the local mount is active", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByText(/no reset email has been sent/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send reset link/i })).not.toBeInTheDocument();
  });
  it("gives the same sentence whether or not the address has an account, and focuses it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "x" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ForgotPasswordForm available />);
    await userEvent.type(screen.getByLabelText(/email/i), "someone@example.test");
    await userEvent.keyboard("{Enter}");
    const status = await screen.findByText(/if that address can recover an account/i);
    expect(fetchMock).toHaveBeenCalledWith("/v1/auth/recovery", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "someone@example.test" }) }));
    await waitFor(() => expect(status.closest("[tabindex='-1']")).toHaveFocus());
  });
});
describe("recovery landing page", () => {
  it("refuses an incomplete link and never shows the form", () => {
    render(<RecoveryForm available tokenHash={null} />);
    expect(screen.getByText(/reset link is incomplete/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
  it("validates locally, submits once, and on success requires signing in again", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ passwordChanged: true, signInRequired: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RecoveryForm available tokenHash="synthetic_hash" />);
    await userEvent.type(screen.getByLabelText(/^new password/i), "a-long-synthetic-passphrase");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "different");
    expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save new password/i })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/confirm new password/i));
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "a-long-synthetic-passphrase");
    await userEvent.type(screen.getByLabelText(/authenticator code/i), "12 34 56");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));
    expect(fetchMock).toHaveBeenCalledWith("/v1/auth/recovery/complete", expect.objectContaining({ body: JSON.stringify({ tokenHash: "synthetic_hash", password: "a-long-synthetic-passphrase", code: "123456" }) }));
    expect(await screen.findByText(/signed out everywhere/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/sign-in");
  });
  it("a refused completion says the link worked once and to request a new one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x" }), { status: 403 })));
    render(<RecoveryForm available tokenHash="synthetic_hash" />);
    await userEvent.type(screen.getByLabelText(/^new password/i), "a-long-synthetic-passphrase");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "a-long-synthetic-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));
    expect(await screen.findByText(/this link works once, so request a new one/i)).toBeInTheDocument();
  });
});
