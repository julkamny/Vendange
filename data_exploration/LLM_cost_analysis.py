import marimo

__generated_with = "0.17.6"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    return (mo,)


@app.cell
def _():
    available_models = {
        "Mistral Small 3.2": {"price": (0.1, 0.3)},
        "gpt-oss-20b": {"price": (0.03, 0.14)}
    }

    selected_model = available_models["gpt-oss-20b"]
    return (selected_model,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    Coût recours à LLM pour segmenter titres et assigner à chaque agent son code-fonction dans corpus Comtesse Ségur.
    """)
    return


@app.cell
def _(selected_model):
    cost_1M_tokens_input, cost_1M_tokens_output = selected_model["price"]

    total_manif_count = 1 * 1e7
    manif_count = total_manif_count / 5 # Proportion très approximative de manifestations comportant mots-clefs illustration ou adapatation ET n'ayant pas déjà agents au code-fonction correct
    input_token_per_manif = 100 # E. g., `$a Le |général Dourakine, par Mme la Comtesse de Ségur,... illustré de 100 vignettes par E. Bayard`
    output_token_per_manif = 150 # E. g., `Émile Bayard $4 illustrateur` et tout le titre – on pourrait se contenter de demander au LLM l'index de la chaîne de caractères formant le titre où les codes de sous-zone doivent être insérés, mais cette méthode reposant sur un calcul précis, il est probable qu'elle soit moins fiable que la réécriture complète du titre segmenté. Ces jetons étant pour la plupart régurgités, peut-être sont-ils considérés comme mis en cache et donc facturés au rabais ?

    input_tokens = manif_count * input_token_per_manif
    total_cost_input = (cost_1M_tokens_input * input_tokens) / (1e6)

    output_tokens = manif_count * output_token_per_manif
    total_cost_output = (cost_1M_tokens_output * output_tokens) / (1e6)

    batch_discount = 0.5
    grand_total = (total_cost_input + total_cost_output) * batch_discount

    print(f"{grand_total:.2f} €")
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
