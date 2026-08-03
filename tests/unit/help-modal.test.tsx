import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { HelpModal } from "../../src/components/help/HelpModal";

describe("HelpModal (Phase 4.3)", () => {
  it("opens with the per-tab content when a data-help button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-help="materials" aria-label="Ayuda sobre insumos">
          ?
        </button>
        <HelpModal />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Ayuda sobre insumos" }));
    const dialog = await screen.findByRole("dialog", { name: /Ayuda: Insumos/ });
    expect(within(dialog).getByText(/Podés hacer esto:/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cerrar ayuda" })).toBeInTheDocument();
  });

  it("closes when the X button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-help="templates" aria-label="Ayuda sobre plantillas">
          ?
        </button>
        <HelpModal />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Ayuda sobre plantillas" }));
    await screen.findByRole("dialog", { name: /Ayuda: Plantillas/ });
    await user.click(screen.getByRole("button", { name: "Cerrar ayuda" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the Escape key is pressed", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-help="templates" aria-label="Ayuda sobre plantillas">
          ?
        </button>
        <HelpModal />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Ayuda sobre plantillas" }));
    await screen.findByRole("dialog", { name: /Ayuda: Plantillas/ });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-help="calculator" aria-label="Ayuda sobre la calculadora">
          ?
        </button>
        <HelpModal />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Ayuda sobre la calculadora" }));
    const dialog = await screen.findByRole("dialog", { name: /Ayuda: Calculadora/ });
    // The backdrop is the parent of the dialog; clicking on the parent
    // (not the dialog itself) triggers the close.
    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the calculator help content when the calculator help button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-help="calculator" aria-label="Ayuda sobre la calculadora">
          ?
        </button>
        <HelpModal />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Ayuda sobre la calculadora" }));
    const dialog = await screen.findByRole("dialog", { name: /Ayuda: Calculadora/ });
    expect(within(dialog).getByText(/Descuento por mayoreo/)).toBeInTheDocument();
  });
});
