import marimo

__generated_with = "0.17.6"
app = marimo.App(width="large")


@app.cell
def _():
    import marimo as mo
    import math
    import pandas as pd
    import matplotlib.pyplot as plt
    return mo, plt


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    # LLM Cost Estimator — Interactive

    Use this interactive app to estimate total spend for batch LLM processing.
    Pick a model, adjust token counts and volumes, and see a clear cost breakdown.

    > 🇫🇷 Contexte : *Coût du recours à un LLM pour segmenter des titres et
    > assigner à chaque agent son code-fonction dans le corpus Comtesse de Ségur.*
    """)
    return


@app.cell
def _():
    # Prices are per 1M tokens; tuple structure: (input_cost_eur, output_cost_eur)
    available_models = {
        "Mistral Small 3.2": {"price": (0.10, 0.30)},
        "gpt-oss-20b": {"price": (0.03, 0.14)},
    }
    default_model = "gpt-oss-20b"
    default_currency_symbol = "€"  # original notebook printed euros
    return available_models, default_currency_symbol, default_model


@app.cell(hide_code=True)
def _(available_models, default_currency_symbol, default_model, mo):
    model_dd = mo.ui.dropdown(
        options=list(available_models.keys()),
        value=default_model,
        label="Model",
        searchable=True,
    )

    use_model_defaults = mo.ui.checkbox(
        value=True, label="Use model default prices (€/1M tokens)"
    )

    # Allow manual override when defaults are off
    manual_in_cost = mo.ui.number(
        start=0, stop=100, step=0.001, value=available_models[default_model]["price"][0],
        label="Manual input cost (€/1M)",
    )
    manual_out_cost = mo.ui.number(
        start=0, stop=100, step=0.001, value=available_models[default_model]["price"][1],
        label="Manual output cost (€/1M)",
    )

    currency_dd = mo.ui.dropdown(
        options=["€", "$", "£"],
        value=default_currency_symbol,
        label="Currency symbol (no FX conversion)",
    )

    # Volume assumptions
    total_items = mo.ui.number(
        start=0, stop=100_000_000, step=100_000, value=10_000_000,
        label="Total items in corpus",
    )
    processed_fraction = mo.ui.slider(
        start=0.0, stop=1.0, step=0.01, value=0.20,
        label="Share processed (0–1)",
    )

    # Token assumptions per item
    input_tokens_per_item = mo.ui.number(
        start=0, stop=100_000, step=1, value=100,
        label="Input tokens per item",
    )
    output_tokens_per_item = mo.ui.number(
        start=0, stop=100_000, step=1, value=150,
        label="Output tokens per item",
    )

    # Discount factor = 1.0 means no discount; 0.5 means 50% off.
    discount_factor = mo.ui.slider(
        start=0.0, stop=1.0, step=0.01, value=0.50,
        label="Bulk discount factor (0–1)",
    )

    # Gate heavy recomputation behind a run button
    run_btn = mo.ui.run_button(label="Recompute estimate")

    mo.vstack(
        [
            mo.md("### 1) Choose model & pricing"),
            mo.hstack([model_dd, currency_dd], justify="start"),
            use_model_defaults,
            mo.hstack([manual_in_cost, manual_out_cost], justify="start"),
            mo.md("### 2) Volume & token assumptions"),
            mo.hstack([total_items, processed_fraction], justify="start"),
            mo.hstack([input_tokens_per_item, output_tokens_per_item], justify="start"),
            mo.md("### 3) Discounts & compute"),
            discount_factor,
            mo.hstack([run_btn], justify="start"),
        ]
    )
    return (
        currency_dd,
        discount_factor,
        input_tokens_per_item,
        manual_in_cost,
        manual_out_cost,
        model_dd,
        output_tokens_per_item,
        processed_fraction,
        run_btn,
        total_items,
        use_model_defaults,
    )


@app.cell
def _(
    available_models,
    manual_in_cost,
    manual_out_cost,
    model_dd,
    use_model_defaults,
):
    selected = available_models[model_dd.value]["price"]
    eff_in_cost = selected[0] if use_model_defaults.value else (manual_in_cost.value or 0.0)
    eff_out_cost = selected[1] if use_model_defaults.value else (manual_out_cost.value or 0.0)
    return eff_in_cost, eff_out_cost


@app.cell
def _(
    currency_dd,
    discount_factor,
    eff_in_cost,
    eff_out_cost,
    input_tokens_per_item,
    mo,
    output_tokens_per_item,
    processed_fraction,
    run_btn,
    total_items,
):
    # Only run when the button is clicked
    mo.stop(not run_btn.value)

    items = int((total_items.value or 0) * (processed_fraction.value or 0.0))
    in_tokens = items * int(input_tokens_per_item.value or 0)
    out_tokens = items * int(output_tokens_per_item.value or 0)

    # Costs are specified per 1,000,000 tokens (€/1M)
    in_cost_total = (eff_in_cost * in_tokens) / 1_000_000.0
    out_cost_total = (eff_out_cost * out_tokens) / 1_000_000.0

    # Apply discount as multiplicative factor (0.5 => 50% off),
    # matching the behavior of the original notebook.
    grand_total = (in_cost_total + out_cost_total) * float(discount_factor.value or 0.0)

    # Provide a structured result for other cells
    result = {
        "items_processed": items,
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
        "input_cost_total": in_cost_total,
        "output_cost_total": out_cost_total,
        "discount_factor": float(discount_factor.value or 0.0),
        "grand_total": grand_total,
        "currency": currency_dd.value,
    }
    return (result,)


@app.cell(hide_code=True)
def _(mo, result):
    if result is None:
        mo.md("> Click **Recompute estimate** to see results.")
    else:
        rows = [
            {"Metric": "Items processed", "Value": f"{result['items_processed']:,}"},
            {"Metric": "Input tokens", "Value": f"{result['input_tokens']:,}"},
            {"Metric": "Output tokens", "Value": f"{result['output_tokens']:,}"},
            {"Metric": "Input cost (total)", "Value": f"{result['input_cost_total']:.2f} {result['currency']}"},
            {"Metric": "Output cost (total)", "Value": f"{result['output_cost_total']:.2f} {result['currency']}"},
            {"Metric": "Discount factor", "Value": f"{result['discount_factor']:.2f}"},
            {"Metric": "Grand total", "Value": f"**{result['grand_total']:.2f} {result['currency']}**"},
        ]
        tbl = mo.ui.table(rows, selection="none")
        mo.md("## Results")
        tbl
    return


@app.cell(hide_code=True)
def _(plt, result):
    if result is None:
        pass

    # Basic bar chart for cost components
    labels = ["Input", "Output", "Grand total (after discount)"]
    values = [
        result["input_cost_total"],
        result["output_cost_total"],
        result["grand_total"],
    ]

    fig = plt.figure()
    ax = fig.gca()
    ax.bar(labels, values)
    ax.set_ylabel(f"Cost ({result['currency']})")
    ax.set_title("Cost breakdown")
    for i, v in enumerate(values):
        ax.text(i, v, f"{v:.2f}", ha="center", va="bottom")
    fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Notes & assumptions

    * Prices are per **1,000,000 tokens** for **input** and **output**.
    * The **bulk discount** is a multiplicative factor
      (e.g., `0.50` means *50% off*) for batch processing offered by some AI providers.
    * Currency is a **symbol only**; no FX conversion is performed.
    * If you switch models while **Use model default prices** is on,
      the corresponding input/output prices are used automatically.
    """)
    return


if __name__ == "__main__":
    app.run()
