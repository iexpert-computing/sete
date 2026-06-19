// mobi-importar-ctrl.js
// Controle da tela de importacao local do MOBI.

var mobiManifestPreview = null;
var mobiImportFilePath = null;

function escapeMobiHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderMobiSummary(summary, manifest) {
    let schema = manifest.schema || manifest.schema_version || "mobi-sete-v1";
    let client = manifest.client || manifest.municipio || {};
    let cityCode = client.mec_co_municipio || client.codigo_ibge || manifest.mec_co_municipio || "Nao informado";

    $("#mobiImportPreview").html(`
        <div class="alert alert-info">
            <b>Previa do arquivo</b><br>
            Schema: ${escapeMobiHtml(schema)}<br>
            Municipio IBGE: ${escapeMobiHtml(cityCode)}<br>
            Escolas: ${summary.escolas} |
            Alunos: ${summary.alunos} |
            Veiculos: ${summary.veiculos} |
            Motoristas: ${summary.motoristas} |
            Monitores: ${summary.monitores} |
            Garagens: ${summary.garagens} |
            Rotas: ${summary.rotas}
        </div>
    `);
}

function renderWarnings(warnings) {
    if (!warnings || warnings.length === 0) {
        $("#mobiImportWarnings").html("");
        return;
    }

    let items = warnings.map((warning) => `<li>${escapeMobiHtml(warning)}</li>`).join("");
    $("#mobiImportWarnings").html(`
        <div class="alert alert-warning">
            <b>Avisos da importacao</b>
            <ul>${items}</ul>
        </div>
    `);
}

$("#mobiImportFile").on("change", async function () {
    $("#mobiImportResult").html("");
    $("#mobiImportWarnings").html("");
    $("#mobiImportPreview").html("");
    $("#mobiImportButton").prop("disabled", true);
    mobiManifestPreview = null;
    mobiImportFilePath = null;

    let file = this.files && this.files[0];
    if (!file) return;

    if (!window.process || !file.path) {
        errorFn("O importador MOBI esta disponivel apenas no aplicativo desktop.");
        return;
    }

    try {
        loadingFn("Lendo arquivo do MOBI...");
        mobiImportFilePath = file.path;
        mobiManifestPreview = await window.mobiLocalReadManifestFromFile(file.path);
        let summary = window.mobiLocalBuildSummary(mobiManifestPreview);
        renderMobiSummary(summary, mobiManifestPreview);
        $("#mobiImportButton").prop("disabled", !window.isMobiLocalMode || !window.isMobiLocalMode());
        Swal2.close();
    } catch (err) {
        Swal2.close();
        errorFn("Nao foi possivel ler o arquivo do MOBI.", err);
    }
});

$("#mobiImportButton").on("click", async () => {
    if (!mobiManifestPreview || !mobiImportFilePath) return;
    if (!window.isMobiLocalMode || !window.isMobiLocalMode()) {
        errorFn("Entre no sistema usando o modo local/MOBI antes de importar.");
        return;
    }

    let confirm = await goaheadDialog(
        "Importar dados do MOBI?",
        "Os dados locais gerenciados pelo MOBI serao substituidos por este arquivo."
    );

    if (!confirm.value) return;

    try {
        loadingFn("Importando dados do MOBI...", "A importacao sera revertida automaticamente se ocorrer erro.");
        let result = await window.mobiLocalImportManifest(mobiManifestPreview);
        renderWarnings(result.warnings);

        $("#mobiImportResult").html(`
            <div class="alert alert-success">
                <b>Importacao concluida</b><br>
                Escolas: ${result.imported.escolas} |
                Alunos: ${result.imported.alunos} |
                Veiculos: ${result.imported.veiculos} |
                Motoristas: ${result.imported.motoristas} |
                Monitores: ${result.imported.monitores} |
                Garagens: ${result.imported.garagens} |
                Rotas: ${result.imported.rotas}
            </div>
        `);

        Swal2.close();
        successDialog("Importacao concluida", "Os dados do MOBI foram carregados no SETE local.");
    } catch (err) {
        Swal2.close();
        errorFn("Erro ao importar dados do MOBI.", err);
    }
});

if (!window.isMobiLocalMode || !window.isMobiLocalMode()) {
    $("#mobiImportButton").prop("disabled", true);
    $("#mobiImportResult").html(`
        <div class="alert alert-warning">
            Para importar dados do MOBI, entre no sistema usando o modo local/MOBI.
        </div>
    `);
}
