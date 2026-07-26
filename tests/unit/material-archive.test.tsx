import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveMaterialAction: vi.fn(),
  unarchiveMaterialAction: vi.fn(),
}));

vi.mock("../../src/server/actions/materials", () => ({
  archiveMaterialAction: mocks.archiveMaterialAction,
  unarchiveMaterialAction: mocks.unarchiveMaterialAction,
}));

import { MaterialArchiveControl } from "../../src/app/materials/MaterialArchiveControl";
import { MaterialsArchiveFeedback } from "../../src/app/materials/MaterialsArchiveFeedback";

const ARCHIVED = { id: "material-1", name: "Soy wax", archived: true } as const;
const ACTIVE = { id: "material-2", name: "Coconut wax", archived: false } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.archiveMaterialAction.mockResolvedValue({ status: "success", materialId: "material-2" });
  mocks.unarchiveMaterialAction.mockResolvedValue({ status: "success", materialId: "material-1" });
});

function mockConfirm(value: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(value);
}

it("renders the archive button with an accessible name for an active material", () => {
  render(<MaterialArchiveControl material={ACTIVE} />);
  expect(screen.getByRole("button", { name: "Archive Coconut wax" })).toBeInTheDocument();
});

it("renders the restore button with an accessible name for an archived material", () => {
  render(<MaterialArchiveControl material={ARCHIVED} />);
  expect(screen.getByRole("button", { name: "Restore Soy wax" })).toBeInTheDocument();
});

it("confirms before archiving and submits the material id only when confirmed", async () => {
  const user = userEvent.setup();
  const accepted = mockConfirm(true);
  const { rerender } = render(<MaterialArchiveControl material={ACTIVE} />);

  await user.click(screen.getByRole("button", { name: "Archive Coconut wax" }));
  expect(accepted).toHaveBeenCalledWith("Archive Coconut wax? You can restore it later.");
  expect(mocks.archiveMaterialAction).toHaveBeenCalledTimes(1);
  expect((mocks.archiveMaterialAction.mock.calls[0][1] as FormData).get("id")).toBe("material-2");
  accepted.mockRestore();

  const cancelled = mockConfirm(false);
  rerender(<MaterialArchiveControl material={ACTIVE} />);
  await user.click(screen.getByRole("button", { name: "Archive Coconut wax" }));
  expect(cancelled).toHaveBeenCalled();
  expect(mocks.archiveMaterialAction).toHaveBeenCalledTimes(1);
  cancelled.mockRestore();
});

it("restores without confirmation when the material is archived", async () => {
  const user = userEvent.setup();
  const confirmSpy = mockConfirm(false);
  render(<MaterialArchiveControl material={ARCHIVED} />);

  await user.click(screen.getByRole("button", { name: "Restore Soy wax" }));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(mocks.unarchiveMaterialAction).toHaveBeenCalledTimes(1);
  expect((mocks.unarchiveMaterialAction.mock.calls[0][1] as FormData).get("id")).toBe("material-1");
  confirmSpy.mockRestore();
});

it("disables the button and shows pending copy while the action is in flight", async () => {
  const user = userEvent.setup();
  let resolveAction!: (value: unknown) => void;
  mocks.archiveMaterialAction.mockImplementation(
    () => new Promise((resolve) => (resolveAction = resolve)),
  );
  const confirmSpy = mockConfirm(true);
  render(<MaterialArchiveControl material={ACTIVE} />);

  await user.click(screen.getByRole("button", { name: "Archive Coconut wax" }));
  expect(await screen.findByRole("button", { name: "Archiving Coconut wax…" })).toBeDisabled();
  resolveAction({ status: "success", materialId: "material-2" });
  await waitFor(() => expect(mocks.archiveMaterialAction).toHaveBeenCalledTimes(1));
  confirmSpy.mockRestore();
});

it("surfaces a server error returned by the archive action", async () => {
  const user = userEvent.setup();
  const confirmSpy = mockConfirm(true);
  mocks.archiveMaterialAction.mockResolvedValue({
    status: "error",
    message: "Material could not be found.",
  });
  render(<MaterialArchiveControl material={ACTIVE} />);

  await user.click(screen.getByRole("button", { name: "Archive Coconut wax" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Material could not be found.");
  confirmSpy.mockRestore();
});

it("surfaces a server error returned by the restore action", async () => {
  const user = userEvent.setup();
  mocks.unarchiveMaterialAction.mockResolvedValue({
    status: "error",
    message: "Unable to restore material.",
  });
  render(<MaterialArchiveControl material={ARCHIVED} />);

  await user.click(screen.getByRole("button", { name: "Restore Soy wax" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to restore material.");
});

it("reports a successful archive with a polite status message rendered by the parent feedback provider", async () => {
  const user = userEvent.setup();
  const confirmSpy = mockConfirm(true);
  // R3-003: success status lives on the parent provider, not the row. The
  // parent renders a persistent role=status that survives row removal.
  render(
    <MaterialsArchiveFeedback view="all" hasRemainingRows>
      <MaterialArchiveControl material={ACTIVE} />
    </MaterialsArchiveFeedback>,
  );

  await user.click(screen.getByRole("button", { name: "Archive Coconut wax" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Coconut wax archived.");
  confirmSpy.mockRestore();
});

it("reports a successful restore with a polite status message rendered by the parent feedback provider", async () => {
  const user = userEvent.setup();
  render(
    <MaterialsArchiveFeedback view="all" hasRemainingRows>
      <MaterialArchiveControl material={ARCHIVED} />
    </MaterialsArchiveFeedback>,
  );

  await user.click(screen.getByRole("button", { name: "Restore Soy wax" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Soy wax restored.");
});
