import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveTemplateAction: vi.fn(),
  restoreTemplateAction: vi.fn(),
  reportLifecycle: vi.fn(),
}));

vi.mock("../../src/server/actions/templates", () => ({
  archiveTemplateAction: mocks.archiveTemplateAction,
  restoreTemplateAction: mocks.restoreTemplateAction,
}));

vi.mock("../../src/app/templates/TemplatesArchiveFeedback", () => ({
  useTemplateArchiveFeedback: () => ({ reportLifecycle: mocks.reportLifecycle }),
}));

import { TemplateArchiveControl } from "../../src/app/templates/TemplateArchiveControl";

const ARCHIVED = { id: "template-1", name: "Citrus candle", archived: true } as const;
const ACTIVE = { id: "template-2", name: "Vanilla candle", archived: false } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.archiveTemplateAction.mockResolvedValue({ status: "success", templateId: "template-2" });
  mocks.restoreTemplateAction.mockResolvedValue({ status: "success", templateId: "template-1" });
});

function mockConfirm(value: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(value);
}

describe("TemplateArchiveControl", () => {
  it.each([
    ["active", ACTIVE, "Archivar Vanilla candle"],
    ["archived", ARCHIVED, "Restaurar Citrus candle"],
  ])("%s card renders the %s button with an accessible name", (_label, template, accessibleName) => {
    render(<TemplateArchiveControl template={template} />);
    expect(screen.getByRole("button", { name: accessibleName })).toBeInTheDocument();
  });

  it("confirms before archiving and skips dispatch on cancel", async () => {
    const user = userEvent.setup();
    const accepted = mockConfirm(true);
    render(<TemplateArchiveControl template={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    expect(accepted).toHaveBeenCalledWith("¿Archivar Vanilla candle? Podés restaurarla después.");
    expect(mocks.archiveTemplateAction).toHaveBeenCalledTimes(1);
    expect((mocks.archiveTemplateAction.mock.calls[0][1] as FormData).get("id")).toBe("template-2");
    accepted.mockRestore();
    mocks.reportLifecycle.mockClear();
    const cancelled = mockConfirm(false);
    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    expect(cancelled).toHaveBeenCalled();
    expect(mocks.archiveTemplateAction).toHaveBeenCalledTimes(1);
    expect(mocks.reportLifecycle).not.toHaveBeenCalled();
    cancelled.mockRestore();
  });

  it("restores without confirmation when the template is archived", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(false);
    render(<TemplateArchiveControl template={ARCHIVED} />);
    await user.click(screen.getByRole("button", { name: "Restaurar Citrus candle" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.restoreTemplateAction).toHaveBeenCalledTimes(1);
    expect((mocks.restoreTemplateAction.mock.calls[0][1] as FormData).get("id")).toBe("template-1");
    confirmSpy.mockRestore();
  });

  it("delegates successful lifecycle feedback to the parent provider", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    render(<TemplateArchiveControl template={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    await waitFor(() =>
      expect(mocks.reportLifecycle).toHaveBeenCalledWith({
        operation: "archive",
        templateId: "template-2",
        templateName: "Vanilla candle",
      }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("discards a failed archive intent before reporting a successful restore", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    mocks.archiveTemplateAction.mockResolvedValueOnce({ status: "error", message: "not found" });
    const { rerender } = render(<TemplateArchiveControl template={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
    rerender(<TemplateArchiveControl template={{ ...ACTIVE, archived: true }} />);
    await user.click(screen.getByRole("button", { name: "Restaurar Vanilla candle" }));
    await waitFor(() =>
      expect(mocks.reportLifecycle).toHaveBeenCalledWith({
        operation: "restore",
        templateId: "template-2",
        templateName: "Vanilla candle",
      }),
    );
    expect(mocks.reportLifecycle).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("disables the button and shows pending copy while the action is in flight", async () => {
    const user = userEvent.setup();
    let resolveAction!: (value: unknown) => void;
    mocks.archiveTemplateAction.mockImplementation(
      () => new Promise((resolve) => (resolveAction = resolve)),
    );
    const confirmSpy = mockConfirm(true);
    render(<TemplateArchiveControl template={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archivar Vanilla candle" }));
    expect(
      await screen.findByRole("button", { name: "Archivando Vanilla candle…" }),
    ).toBeDisabled();
    resolveAction({ status: "success", templateId: "template-2" });
    await waitFor(() => expect(mocks.archiveTemplateAction).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it.each([
    [
      "archive",
      ACTIVE,
      "Archivar Vanilla candle",
      mocks.archiveTemplateAction,
      "Template could not be found.",
    ],
    [
      "restore",
      ARCHIVED,
      "Restaurar Citrus candle",
      mocks.restoreTemplateAction,
      "Unable to restore template.",
    ],
  ])("surfaces a server error returned by the %s action", async (_op, template, btn, fn, message) => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    fn.mockResolvedValue({ status: "error", message });
    render(<TemplateArchiveControl template={template} />);
    await user.click(screen.getByRole("button", { name: btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    confirmSpy.mockRestore();
  });
});
