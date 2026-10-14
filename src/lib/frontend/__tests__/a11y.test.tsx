// FE-1 automated a11y gate (axe-core on composed foundation UI).
// A clean axe run is a gate, NOT a WCAG conformance claim (manual AT testing still required).
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import { Button } from "../../../components/ui/button";
import { Field, TextInput } from "../../../components/ui/field";
import { Card } from "../../../components/ui/card";
import { EmptyState, ErrorState } from "../../../components/ui/states";
import { PurchasePanel } from "../../../components/store/purchase-panel";
import { ToastProvider } from "../../../components/ui/toast";
import type { ProductPageData } from "../storefront-reads";

describe("foundation a11y (axe-core)", () => {
  it("composed Button + Field + Card + states have no axe violations", async () => {
    const { container } = render(
      <main dir="rtl" lang="ar">
        <h1>عنوان تجريبي</h1>
        <Card>
          <Field label="الاسم" error="خطأ تجريبي">
            {({ inputId, describedBy }) => <TextInput inputId={inputId} describedBy={describedBy} invalid />}
          </Field>
          <Button>حفظ</Button>
        </Card>
        <EmptyState title="فارغ تجريبي" />
        <ErrorState text="خطأ تجريبي" />
      </main>,
    );
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("purchase island (WEIGHT + presets) has no axe violations", async () => {
    const product: ProductPageData = {
      id: "p",
      name: "جبنة اختبار",
      slug: "s",
      description: null,
      brandName: null,
      categoryName: "ألبان",
      productType: "WEIGHT",
      saleStepGrams: 250,
      gallery: [],
      variants: [
        {
          id: "v",
          name: "رومي",
          sizeValue: null,
          sizeUnit: "KG",
          price: "320.00",
          compareAt: null,
          stock: "in",
        },
      ],
    };
    const { container } = render(
      <ToastProvider>
        <PurchasePanel product={product} />
      </ToastProvider>,
    );
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
