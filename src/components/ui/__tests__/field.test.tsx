// FE-1 Field/TextInput tests: label association, error wiring, RTL render.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, TextInput } from "../field";

describe("Field", () => {
  it("associates label with input and wires error via describedby", () => {
    render(
      <div dir="rtl" lang="ar">
        <Field label="رقم الهاتف" required hint="تلميح" error="خطأ تجريبي">
          {({ inputId, describedBy }) => <TextInput inputId={inputId} describedBy={describedBy} invalid />}
        </Field>
      </div>,
    );
    const input = screen.getByLabelText(/رقم الهاتف/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const described = input.getAttribute("aria-describedby") ?? "";
    expect(described).not.toBe("");
    expect(screen.getByRole("alert")).toHaveTextContent("خطأ تجريبي");
  });

  it("shows hint when there is no error", () => {
    render(
      <Field label="المدينة" hint="تلميح تجريبي">
        {({ inputId, describedBy }) => <TextInput inputId={inputId} describedBy={describedBy} />}
      </Field>,
    );
    expect(screen.getByText("تلميح تجريبي")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
