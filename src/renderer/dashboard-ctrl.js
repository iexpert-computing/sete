// dashboard-ctrl.js
// Este arquivo provê os scripts básicos para controlar a tela inicial do SETE

// Mapa do dashboard
var mapa = novoMapaOpenLayers("mapaDashboard", cidadeLatitude, cidadeLongitude);

// Variável que armazena os alunos apresentados (será preenchida)
var hashMapAlunos = new Map();
var hashMapEscolas = new Map();
var hashMapRotas = new Map();
var hashMapVeiculos = new Map();
var hashMapRealTimePercurso = new Map();
var hashMapRealTimeAlerta = new Map();

var camadaAlertas = null;
var camadaVeiculos = null;

window.onresize = function () {
    setTimeout(function () {
        if (mapa != null) { mapa["map"].updateSize(); }
    }, 200);
}

var vectorSource = mapa["vectorSource"];
var vectorLayer = mapa["vectorLayer"];
var mapaOL = mapa["map"];

// Ativa busca
mapa["activateGeocoder"]();

// Ativa camadas
// mapa["activateImageLayerSwitcher"]();

// Ativa impressão
// mapa["activatePrinting"]();

// Mostra âncora de loading
$(".content").hide();

if (firstAcess) {
    loadingFn("Sincronizando os dados com a nuvem...", "Espere um minutinho...");
    $(".preload").hide();
} else {
    $(".preload").show();
}

// Ativa links de navegação
$(".link-dash").on('click', function () {
    navigateDashboard("./modules/" + $(this).attr("name") + ".html");
});

if (userconfig.get("NOME")) {
    $("#userName").html(userconfig.get("NOME").split(" ")[0]);
}

var DASHBOARD_STAGE_TIMEOUT_MS = 30000;
var DASHBOARD_UPDATE_TIMEOUT_MS = 10000;

function dashboardLocalMode() {
    return Boolean(window.isMobiLocalMode && window.isMobiLocalMode());
}

function dashboardLog(stageName, message, payload) {
    let prefix = `[dashboard][${stageName}] ${message}`;
    if (payload !== undefined) {
        console.log(prefix, payload);
    } else {
        console.log(prefix);
    }
}

function withDashboardTimeout(stageName, task, timeoutMs = DASHBOARD_STAGE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let finished = false;
        let timer = setTimeout(() => {
            if (finished) return;
            let err = new Error(`Tempo limite ao carregar a etapa "${stageName}".`);
            err.dashboardStage = stageName;
            reject(err);
        }, timeoutMs);

        Promise.resolve()
            .then(task)
            .then((result) => {
                finished = true;
                clearTimeout(timer);
                resolve(result);
            })
            .catch((err) => {
                finished = true;
                clearTimeout(timer);
                reject(err);
            });
    });
}

async function runDashboardStage(stageName, task, timeoutMs = DASHBOARD_STAGE_TIMEOUT_MS) {
    let startedAt = window.performance.now();
    dashboardLog(stageName, "inicio");
    try {
        let result = await withDashboardTimeout(stageName, task, timeoutMs);
        let elapsed = Math.round(window.performance.now() - startedAt);
        dashboardLog(stageName, `fim em ${elapsed} ms`);
        return result;
    } catch (err) {
        err.dashboardStage = err.dashboardStage || stageName;
        console.error(`[dashboard][${stageName}] falhou`, err);
        throw err;
    }
}

async function preparaAcessoDashboard() {
    if (dashboardLocalMode()) {
        if (window.mobiLocalReady) {
            await window.mobiLocalReady;
        } else if (window.mobiLocalEnsureReady) {
            await window.mobiLocalEnsureReady();
        } else if (window.mobiLocalEnsureSchema) {
            if (window.installMobiLocalRestAdapter) window.installMobiLocalRestAdapter();
            await window.mobiLocalEnsureSchema();
            if (window.installMobiLocalRestAdapter) window.installMobiLocalRestAdapter();
        } else {
            throw new Error("Adaptador local/MOBI nao foi carregado.");
        }
        return;
    }

    await restImpl.restAPI.get(BASE_URL + "/authenticator/sete");
}

function fechaLoadingDashboard() {
    if (typeof Swal2 !== "undefined" && Swal2.close) {
        Swal2.close();
    }
}

function mostraConteudoDashboard() {
    $(".preload").fadeOut(200, function () {
        $(".content").fadeIn(200);
    });
    fechaLoadingDashboard();

    setTimeout(function () {
        if (mapa != null) { mapa["map"].updateSize(); }
    }, 1500);

    // mostraSeTemUpdate(firstAcess);
    firstAcess = false;

    return firstAcess;
}

function mensagemErroDashboard(err) {
    let stage = err && err.dashboardStage ? `Etapa: ${err.dashboardStage}. ` : "";
    let detail = err && err.message ? err.message : "Erro nao identificado.";
    return `${stage}${detail}`;
}

function trataErroDashboard(err) {
    let localMode = dashboardLocalMode();
    fechaLoadingDashboard();
    $(".preload").hide();

    if (localMode) {
        $(".content").fadeIn(200);
        return errorFn(
            "Falha ao carregar os dados locais/MOBI.",
            mensagemErroDashboard(err),
            "Falha no modo local/MOBI"
        );
    }

    return errorFn("Acesso inválido", mensagemErroDashboard(err), "Acesso inválido")
        .then(() => {
            document.location.href = "./login-view.html";
        });
}

async function inicializaDashboard() {
    try {
        await runDashboardStage(dashboardLocalMode() ? "modo local/MOBI" : "autenticacao", preparaAcessoDashboard);
        await runDashboardStage("alunos/escolas", preencheDashboardAlunosEscolas);
        await runDashboardStage("veiculos", preencheDashboardVeiculos);
        await runDashboardStage("rotas", preencheDashboardRotas);
        await runDashboardStage("mapa", preencheMapa);

        if (firstAcess && !dashboardLocalMode()) {
            await runDashboardStage("verificacao de update", () => mostraSeTemUpdate(false), DASHBOARD_UPDATE_TIMEOUT_MS);
        } else if (dashboardLocalMode()) {
            dashboardLog("verificacao de update", "ignorada no modo local/MOBI");
        }

        mostraConteudoDashboard();
    } catch (err) {
        trataErroDashboard(err);
    }
}

inicializaDashboard();

// Funções que Preenchem o Dashboard
async function preencheDashboardAlunosEscolas() {
    let alunos = [];
    let escolas = [];
    let alunosRAW = [];
    let escolasRAW = [];
    let rotasRAW = [];
    let escolaSet = new Set();
    try {
        alunosRAW = await restImpl.dbGETColecao(DB_TABLE_ALUNO);
        escolasRAW = await restImpl.dbGETColecao(DB_TABLE_ESCOLA);
        rotasRAW = await restImpl.dbGETColecao(DB_TABLE_ROTA);

        alunosRAW.forEach(aluno => {
            let alunoJSON = parseAlunoREST(aluno);
            // Adiciona no hashmap
            hashMapAlunos.set(alunoJSON["ID"], alunoJSON);

            if (aluno.rota && aluno.rota != "Não Informada") {
                if (aluno.escola && aluno.escola != "Não Informada") {
                    alunos.push(aluno);
                    escolaSet.add(aluno.escola);
                } else {
                    alunos.push(aluno);
                }
            }
        });

        escolas = [...escolaSet];

        // Salva as escolas
        escolasRAW.forEach(escola => {
            let escolaJSON = parseEscolaREST(escola);
            // Adiciona no hashmap
            escolaJSON["NUM_ALUNOS"] = escolaJSON["qtd_alunos"];
            hashMapEscolas.set(escolaJSON["ID"], escolaJSON);
        })
    } finally {
        $("#alunosAtendidos").text(alunos.length + " / "  + alunosRAW.length);
        $("#escolasAtendidas").text(escolas.length + " / " + escolasRAW.length);
    }
}

async function preencheDashboardVeiculos() {
    let veiculos = [];
    let func = naofunc = 0;
    try {
        veiculos = await restImpl.dbGETColecao(DB_TABLE_VEICULO);

        veiculos.forEach(veiculo => {
            let veiculoJSON = parseVeiculoREST(veiculo);
            hashMapVeiculos.set(veiculoJSON["ID"], veiculoJSON);
            veiculoJSON["MANUTENCAO"] == "Sim" ? naofunc++ : func++
        })
    } finally {
        $("#veiculosFuncionamento").text(func);
        $("#veiculosNaoFuncionamento").text(naofunc);
    }
}

async function pegarShapeRota(rotaID) {
    return new Promise((resolve, reject) => {
        restImpl.dbGETEntidade(DB_TABLE_ROTA, `/${rotaID}/shape`)
        .then(shapeDaRota => {
            resolve({rotaID, shape: shapeDaRota.shape})
        })
        .catch(err => {
            resolve({rotaID, shape: null})
        })
    })
}

async function preencheDashboardRotas() {
    let rotas = [];
    let totalRotas = 0;
    let totalKM = 0;
    let totalKMMedio = 0;
    let totalTempo = 0;
    try {
        rotas = await restImpl.dbGETColecao(DB_TABLE_ROTA);
        totalRotas = rotas.length;
        var start = window.performance.now();
        let promiseArray = [];

        for (let rota of rotas) {
            let rotaID = rota["id_rota"] || rota["ID_ROTA"] || rota["id"] || rota["ID"];
            if (rotaID === undefined || rotaID === null || rotaID === "") {
                console.warn("[dashboard][rotas] rota sem identificador ignorada", rota);
                continue;
            }
            let rotaDetalheRaw = await restImpl.dbGETEntidade(DB_TABLE_ROTA, `/${rotaID}`);
            if (!rotaDetalheRaw || Object.keys(rotaDetalheRaw).length === 0) {
                rotaDetalheRaw = rota;
            }

            let rotaJSON = parseRotaDBREST(rotaDetalheRaw);
            rotaJSON["NOME"] = rotaJSON["NOME"] || rotaJSON["nome"] || `Rota ${rotaID}`;
            rotaJSON["NUM_ALUNOS_ROTA"] = 0;
            rotaJSON["SHAPE"] = null;

            promiseArray.push(pegarShapeRota(rotaID))
            hashMapRotas.set(rotaID, rotaJSON);

            let rotakm = strToNumber(rotaJSON.km || rotaJSON["KM"] || 0);
            if (Number.isNaN(rotakm)) rotakm = 0;
            totalKM = totalKM + rotakm;
        }

        let dadosRotas = await Promise.all(promiseArray);
        for (let dadoRota of dadosRotas) {
            if (dadoRota.shape != null) {
                let rotaJSON = hashMapRotas.get(dadoRota.rotaID);
                rotaJSON["SHAPE"] = dadoRota.shape;
                hashMapRotas.set(dadoRota.rotaID, rotaJSON);
            }
        }
        var end = window.performance.now();
        console.log(`Execution time: ${end - start} ms`);
        console.log(`Execution time: ${end - start} ms`);
        console.log(`Execution time: ${end - start} ms`);
    } finally {
        if (totalRotas != 0) {
            totalKMMedio = Math.round(totalKM / totalRotas);
        }
        $("#qtdeRotas").text(totalRotas);
        $("#kmTotal").text(Math.round(totalKM) + " km");
        $("#kmMedio").text(totalKMMedio + " km");
        $("#tempoMedio").text(totalTempo + " min");
    }
}

function preencheRelacoes() {
    var dashPromises = new Array();

    dashPromises.push(dbBuscarTodosDadosPromise(DB_TABLE_ESCOLA_TEM_ALUNOS).then((res) => {
        for (let relEscolaAluno of res) {
            let eID = relEscolaAluno["ID_ESCOLA"];
            let aID = relEscolaAluno["ID_ALUNO"];

            if (hashMapEscolas.has(eID)) {
                let escolaJSON = hashMapEscolas.get(eID);
                let alunoJSON = hashMapAlunos.get(aID);

                escolaJSON["NUM_ALUNOS"] = escolaJSON["NUM_ALUNOS"] + 1;
                if (alunoJSON) { // tem GPS
                    alunoJSON["ESCOLA"] = escolaJSON["NOME"];
                    hashMapAlunos.set(aID, alunoJSON);
                }
                hashMapEscolas.set(eID, escolaJSON);
            }
        }
    }))

    dashPromises.push(dbBuscarTodosDadosPromise(DB_TABLE_ROTA_ATENDE_ALUNO).then((res) => {
        for (let relRotaAluno of res) {
            let rID = relRotaAluno["ID_ROTA"];
            let aID = relRotaAluno["ID_ALUNO"];

            if (hashMapRotas.has(rID)) {
                let rotaJSON = hashMapRotas.get(rID);
                let alunoJSON = hashMapAlunos.get(aID);

                rotaJSON["NUM_ALUNOS_ROTA"] = rotaJSON["NUM_ALUNOS_ROTA"] + 1;
                if (alunoJSON) { // tem 
                    alunoJSON["ROTA"] = rotaJSON["NOME"];
                    hashMapAlunos.set(aID, alunoJSON);
                }
                hashMapRotas.set(rID, rotaJSON);
            }
        }
    }))

    dashPromises.push(dbBuscarTodosDadosNoServidorPromise(DB_TABLE_REALTIME_VIAGENSPERCURSO).then((res) => {
        let dataDeHoje = new Date().toISOString().split("T")[0];
        for (let viagemPercurso of res) {
            if (viagemPercurso.DATA_INICIO) {
                try {
                    let dataViagem = viagemPercurso.DATA_INICIO.split("T")[0];

                    if (dataViagem == dataDeHoje) {
                        if (viagemPercurso.TIPO_VEICULO && viagemPercurso.COORDENADAS &&
                            viagemPercurso.NOME_ROTA && viagemPercurso.NOME_MOTORISTA) {
                            hashMapRealTimePercurso.set(viagemPercurso.ID, viagemPercurso);
                        }
                    }
                } catch (err) {
                    console.error("ERROR", err)
                }
            }
        }
    }))

    return Promise.all(dashPromises)
}

function nomeSeguroRota(rota, rotaKey) {
    let nome = rota ? (rota["NOME"] || rota["nome"]) : "";
    nome = String(nome || "").trim();
    if (nome !== "") return nome;
    if (rotaKey !== undefined && rotaKey !== null && rotaKey !== "") return `Rota ${rotaKey}`;
    return "Rota sem nome";
}

function compararRotasDashboard(a, b) {
    let nomeA = nomeSeguroRota(hashMapRotas.get(a), a).toLowerCase();
    let nomeB = nomeSeguroRota(hashMapRotas.get(b), b).toLowerCase();
    let parA = nomeA.split(" ");
    let parB = nomeB.split(" ");

    if (parA.length > 0 && parB.length > 0) {
        parA = parA[0];
        parB = parB[0];
        if (isNumeric(parA) && isNumeric(parB)) {
            return parA - parB;
        }
    }
    return nomeA.localeCompare(nomeB);
}

// Preenche Mapa
function preencheMapa() {
    let categoriasAluno = ["Infantil", "Fundamental", "Médio", "Superior", "Outro"];
    let categoriasEscola = ["Municipal", "Estadual", "Federal", "Privada"];

    let lyrAluno = {};
    let lyrEscola = {};
    let lyrRotas = {};

    categoriasAluno.forEach(cat => lyrAluno[cat] = mapa["createLayer"](cat, cat, true))
    categoriasEscola.forEach(cat => lyrEscola[cat] = mapa["createLayer"](cat, cat, true))

    for (let aluno of hashMapAlunos.values()) {
        if (categoriasAluno.includes(aluno.NIVELSTR) &&
            aluno["LOC_LONGITUDE"] != "" && aluno["LOC_LONGITUDE"] != undefined &&
            aluno["LOC_LATITUDE"] != "" && aluno["LOC_LONGITUDE"] != undefined) {
            let vSource = lyrAluno[aluno.NIVELSTR].source;
            vSource.addFeature(plotarAluno(aluno));

            let vLayer = lyrAluno[aluno.NIVELSTR].layer;
            vLayer.setZIndex(10);
        }
    }

    let grupoLayersAlunos = [];
    categoriasAluno.reverse().forEach(cat => grupoLayersAlunos.push(lyrAluno[cat].layer));

    for (let escola of hashMapEscolas.values()) {
        if (categoriasEscola.includes(escola.DEPENDENCIA) &&
            escola["LOC_LONGITUDE"] != "" && escola["LOC_LONGITUDE"] != undefined &&
            escola["LOC_LATITUDE"] != "" && escola["LOC_LONGITUDE"] != undefined) {
            let vSource = lyrEscola[escola.DEPENDENCIA].source;
            vSource.addFeature(plotarEscola(escola));

            let vLayer = lyrEscola[escola.DEPENDENCIA].layer;
            vLayer.setZIndex(20);
        }
    }

    let grupoLayersEscolas = [];
    categoriasEscola.reverse().forEach(cat => grupoLayersEscolas.push(lyrEscola[cat].layer));

    [...hashMapRotas.keys()].sort(compararRotasDashboard).reverse().forEach(rotaKey => {
        let rota = hashMapRotas.get(rotaKey);
        if (!rota) return;
        if (rota["SHAPE"] != "" && rota["SHAPE"] != null && rota["SHAPE"] != undefined) {
            try {
                let rotaNome = nomeSeguroRota(rota, rotaKey);
                let rotaCor = proximaCor();
                let rotaGeoJSON = (new ol.format.GeoJSON()).readFeatures(rota["SHAPE"]);

                // Processando rota
                let tamanhoRota = 0;
                let tamanhoRotaStr = "";
                rotaGeoJSON.forEach(f => {
                    if (f.getGeometry() instanceof ol.geom.LineString) {
                        tamanhoRota = tamanhoRota + ol.sphere.getLength(f.getGeometry());
                    }
                })

                if (tamanhoRota > 100) {
                    tamanhoRotaStr = (Math.round(tamanhoRota / 1000 * 100) / 100) + ' ' + 'km';
                } else {
                    tamanhoRotaStr = (Math.round(tamanhoRota * 100) / 100) + ' ' + 'm';
                }

                rotaGeoJSON.forEach(f => {
                    f.set("NOME", rotaNome);
                    f.set("KM", rota["KM"]);
                    f.set("TEMPO", rota["TEMPO"] != "" ? rota["TEMPO"] : "Não");
                    f.set("NUM_ALUNOS_ROTA", rota["NUM_ALUNOS_ROTA"]);
                    f.set("TIPO", "ROTA");
                });

                let rotaStyles = [
                    new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: "white",
                            width: 7
                        })
                    }),
                    new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: rotaCor,
                            width: 5
                        })
                    })
                ]

                let camada = mapa["createLayer"](rotaNome, rotaNome, true)
                camada.source.addFeatures(rotaGeoJSON);
                camada.layer.setStyle(rotaStyles);
                camada.layer.setZIndex(1);
                camada.layer.setVisible(true);
                camada.layer.setExtent(camada.source.getExtent());
                lyrRotas[rotaNome] = camada;
            } catch (error) {
                console.log(error);
            }
        }
    })

    //TODO:
    // $("label[title='Rotas']").click(() => {
    //     $("label[title='Rotas']").parent().parent().find("label").trigger('click')
    // })

    let grupoLayersRotas = [];
    [...hashMapRotas.keys()].sort(compararRotasDashboard).reverse().forEach(rotaKey => {
        let rota = hashMapRotas.get(rotaKey);
        if (!rota) return;
        let rotaNome = nomeSeguroRota(rota, rotaKey);
        if (rotaNome in lyrRotas) {
            grupoLayersRotas.push(lyrRotas[rotaNome].layer)
        }
    });

    // Processa dados em tempo real
    // camadaAlertas = mapa["createLayer"]("Alertas", "Alertas", true);
    // camadaAlertas.layer.setZIndex(100);

    // camadaVeiculos = mapa["createLayer"]("Veículos", "Veículos", true);
    // camadaVeiculos.layer.setZIndex(90);

    // processaDadosAlerta();
    // processaDadosPercurso();

    // camadaVeiculos.layer.setStyle(new ol.style.Style({
    //     stroke: new ol.style.Stroke({
    //         color: "white",
    //         width: 7
    //     })
    // }));

    mapa["addGroupLayer"]("Rotas", new ol.Collection(grupoLayersRotas));
    mapa["addGroupLayer"]("Escolas", grupoLayersEscolas);
    mapa["addGroupLayer"]("Alunos", grupoLayersAlunos);
    // mapa["addGroupLayer"]("Tempo Real", [camadaAlertas.layer, camadaVeiculos.layer]);

    // Popup
    mapa["map"].addInteraction(selectAlunoEscolaConfig);
    mapa["map"].addOverlay(popupAlunoEscolaConfig);

    var lswitcher = new ol.control.LayerSwitcher({
        target: $(".camadasMapaDashboard").get(0),
        reordering: false,
        extent: true,
        trash: false,
    });
    mapaOL.addControl(lswitcher);

    // TODO: aplicar extent 
    return mapaOL
}

// Cria feature de um aluno
var plotarAluno = (aluno) => {
    let alat = aluno["LOC_LATITUDE"];
    let alng = aluno["LOC_LONGITUDE"];
    let pontoAluno = gerarMarcador(alat, alng, "img/icones/aluno-marcador.png");

    pontoAluno.setId(aluno["ID_ALUNO"]);
    pontoAluno.set("NOME", aluno["NOME"]);
    pontoAluno.set("DATA_NASCIMENTO", aluno["DATA_NASCIMENTO"]);
    pontoAluno.set("ESCOLA", aluno["ESCOLA"]);
    pontoAluno.set("TURNOSTR", aluno["TURNOSTR"]);
    pontoAluno.set("NIVELSTR", aluno["NIVELSTR"]);
    pontoAluno.set("TIPO", "ALUNO");

    if (aluno["SEXO"] == 1) {
        pontoAluno.set("SEXO", "Masculino");
    } else {
        pontoAluno.set("SEXO", "Feminino");
    }

    return pontoAluno;
}

// Cria feature de uma escola
var plotarEscola = (escolaJSON) => {
    let escolaID = escolaJSON["ID_ESCOLA"];
    let lat = escolaJSON["LOC_LATITUDE"];
    let lng = escolaJSON["LOC_LONGITUDE"];

    let pontoEscola = gerarMarcador(lat, lng, "img/icones/escola-marcador.png");
    pontoEscola.setId(escolaID);
    pontoEscola.set("NOME", escolaJSON["NOME"]);
    pontoEscola.set("TIPO", "ESCOLA");
    pontoEscola.set("DEPENDENCIA", escolaJSON["DEPENDENCIA"]);
    pontoEscola.set("HORARIO", escolaJSON["HORARIO"]);
    // pontoEscola.set("REGIME", escolaJSON["REGIME"]);
    pontoEscola.set("ENSINO", escolaJSON["ENSINO"])
    pontoEscola.set("NUM_ALUNOS", escolaJSON["NUM_ALUNOS"]);
    pontoEscola.set("CONTATO_TELEFONE", escolaJSON["CONTATO_TELEFONE"]);

    return pontoEscola;
}

// Cria feature de um alerta
var plotarAlerta = (alertaJSON) => {
    let alertaID = alertaJSON["ID"];
    let lat = alertaJSON["LOC_LATITUDE"];
    let lng = alertaJSON["LOC_LONGITUDE"];

    let pontoAlerta;
    switch (alertaJSON["TIPO_ALERTA"]) {
        case 0:
            pontoAlerta = gerarMarcador(lat, lng, "img/icones/alertagenerico-marker.png");
            pontoAlerta.set("NOME", "Outro problema");
        case 1:
            pontoAlerta = gerarMarcador(lat, lng, "img/icones/barrera-marker.png");
            pontoAlerta.set("NOME", "Via Interditada");
        case 2:
            pontoAlerta = gerarMarcador(lat, lng, "img/icones/probmecanico-marker.png");
            pontoAlerta.set("NOME", "Problema Mecânico");
        case 3:
            pontoAlerta = gerarMarcador(lat, lng, "img/icones/alertagenerico-marker.png");
            pontoAlerta.set("NOME", "Problema Mecânico");
        default:
            pontoAlerta = gerarMarcador(lat, lng, "img/icones/alertagenerico-marker.png");
            pontoAlerta.set("NOME", "Outro problema");
            break;
    }
    pontoAlerta.setId(alertaID);

    pontoAlerta.set("TIPO", "ALERTA");
    pontoAlerta.set("HORA_OCORRENCIA", alertaJSON.DATA_OCORRENCIA.split("T")[1]);
    pontoAlerta.set("DATA_OCORRENCIA", alertaJSON.DATA_OCORRENCIA.split("T")[0]);

    if (alertaJSON["MENSAGEM"] == "") {
        pontoAlerta.set("MENSAGEM", "Não informado");
    } else {
        pontoAlerta.set("MENSAGEM", alertaJSON["MENSAGEM"]);
    }

    pontoAlerta.set("ALERTA_NOME_MOTORISTA", alertaJSON["ALERTA_NOME_MOTORISTA"]);
    pontoAlerta.set("ALERTA_NOME_ROTA", alertaJSON["ALERTA_NOME_ROTA"]);

    return pontoAlerta;
}


// Cria feature de um alerta
var plotarVeiculo = (veiculoJSON) => {
    let veiculoID = veiculoJSON["ID"];
    let lat = veiculoJSON["LOC_LATITUDE"];
    let lng = veiculoJSON["LOC_LONGITUDE"];

    let pontoVeiculo;
    switch (veiculoJSON["TIPO_VEICULO"]) {
        case 1:
            pontoVeiculo = gerarMarcador(lat, lng, "img/icones/onibus-marcador.png");
        case 2:
            pontoVeiculo = gerarMarcador(lat, lng, "img/icones/lancha-marcador2.png");
        default:
            pontoVeiculo = gerarMarcador(lat, lng, "img/icones/onibus-marcador.png");
            break;
    }
    pontoVeiculo.setId(veiculoID);
    pontoVeiculo.set("TIPO", "VEICULO");
    pontoVeiculo.set("NOME", veiculoJSON["NOME"]);
    pontoVeiculo.set("NOME_MOTORISTA", veiculoJSON["NOME"]);
    pontoVeiculo.set("MODELOSTR", veiculoJSON["MODELOSTR"]);
    pontoVeiculo.set("ROTA", veiculoJSON["NOME_ROTA"])
    pontoVeiculo.set("ULTIMA_ATUALIZACAO", veiculoJSON.DATA_ATUAL.split("T")[1].split(".")[0]);

    let tempoViagem = (Date.parse(veiculoJSON.DATA_ATUAL) - Date.parse(veiculoJSON.DATA_INICIO)) / 1000 / 600;
    pontoVeiculo.set("TEMPO_VIAGEM", tempoViagem.toFixed(2) + " minutos");

    return pontoVeiculo;
}


///////////////////////////////////////////////////////////////////////////////
// Popup
///////////////////////////////////////////////////////////////////////////////
var selectAlunoEscolaConfig = new ol.interaction.Select({
    hitTolerance: 5,
    multi: false,
    condition: ol.events.condition.singleClick,
    filter: (feature, layer) => {
        console.log("feature", feature.getProperties())
        if ((feature.getGeometry().getType() == "Point" && (feature.getProperties().TIPO == "ALUNO" ||
            feature.getProperties().TIPO == "ESCOLA" || feature.getProperties().TIPO == "ALERTA" ||
            feature.getProperties().TIPO == "VEICULO"))
            ||
            (feature.getGeometry().getType() == "LineString" && feature.getProperties().TIPO == "ROTA")) {
            return true;
        } else {
            return false;
        }
    }
});

var popupAlunoEscolaConfig = new ol.Overlay.PopupFeature({
    popupClass: "default anim",
    select: selectAlunoEscolaConfig,
    closeBox: true,
    template: {
        title: (elem) => {
            return elem.get("NOME");
        },
        attributes: {
            'NIVELSTR': {
                title: "Série",
                visible: (e) => e.getProperties().TIPO == "ALUNO"
            },
            'TURNOSTR': {
                title: "Turno",
                visible: (e) => e.getProperties().TIPO == "ALUNO"
            },
            'ESCOLA': {
                title: "Escola",
                visible: (e) => e.getProperties().TIPO == "ALUNO"
            },
            'DEPENDENCIA': {
                title: "Tipo",
                visible: (e) => e.getProperties().TIPO == "ESCOLA"
            },
            'REGIME': {
                title: "Regime",
                visible: (e) => e.getProperties().TIPO == "ESCOLA"
            },
            'ENSINO': {
                title: "Níveis",
                visible: (e) => e.getProperties().TIPO == "ESCOLA"
            },
            'HORARIO': {
                title: "Horário de Funcionamento",
                visible: (e) => e.getProperties().TIPO == "ESCOLA"
            },
            'NUM_ALUNOS': {
                title: "Número de alunos",
                visible: (e) => e.getProperties().TIPO == "ESCOLA"
            },
            'KM': {
                title: 'Tamanho da Rota',  // attribute's title
                before: '',           // something to add before
                format: ol.Overlay.PopupFeature.localString(),  // format as local string
                after: ' km',        // something to add after
                visible: (e) => e.getProperties().TIPO == "ROTA"
            },
            'TEMPO': {
                title: 'Tempo estimado',  // attribute's title
                before: '',           // something to add before
                format: ol.Overlay.PopupFeature.localString(),  // format as local string
                after: ' min',        // something to add after
                visible: (e) => e.getProperties().TIPO == "ROTA"
            },
            'NUM_ALUNOS_ROTA': {
                title: "Número de alunos",
                visible: (e) => e.getProperties().TIPO == "ROTA"
            },
            'MENSAGEM': {
                title: "Mensagem:",
                visible: (e) => e.getProperties().TIPO == "ALERTA"
            },
            'ALERTA_NOME_MOTORISTA': {
                title: "Autor:",
                visible: (e) => e.getProperties().TIPO == "ALERTA"
            },
            'ALERTA_NOME_ROTA': {
                title: "Rota:",
                visible: (e) => e.getProperties().TIPO == "ALERTA"
            },
            'HORA_OCORRENCIA': {
                title: "Hora da ocorrência:",
                visible: (e) => e.getProperties().TIPO == "ALERTA"
            },
            'DATA_OCORRENCIA': {
                title: "Data da ocorrência",
                visible: (e) => e.getProperties().TIPO == "ALERTA"
            },
            'ROTA': {
                title: "Rota:",
                visible: (e) => e.getProperties().TIPO == "VEICULO"
            },
            'NOME_MOTORISTA': {
                title: "Nome do Motorista:",
                visible: (e) => e.getProperties().TIPO == "VEICULO"
            },
            'MODELOSTR': {
                title: "Modelo do veículo:",
                visible: (e) => e.getProperties().TIPO == "VEICULO"
            },

            'ULTIMA_ATUALIZACAO': {
                title: "Última atualização:",
                visible: (e) => e.getProperties().TIPO == "VEICULO"
            },
            'TEMPO_VIAGEM': {
                title: "Tempo de viagem:",
                visible: (e) => e.getProperties().TIPO == "VEICULO"
            },
        }
    }
});

function processaDadosAlerta() {
    for (let alerta of hashMapRealTimeAlerta.values()) {
        try {
            let idViagem = alerta.VIAGEM_ID;
            let viagem = hashMapRealTimePercurso.get(idViagem);

            if (viagem) {
                alerta["ALERTA_NOME_MOTORISTA"] = viagem.NOME_MOTORISTA;
                alerta["ALERTA_NOME_ROTA"] = viagem.NOME_ROTA;
                let vSource = camadaAlertas.source;
                vSource.addFeature(plotarAlerta(alerta));
            }
        } catch (error) {
            console.error("ERROR", error)
        }
    }
}

function processaDadosPercurso() {
    for (let rota of hashMapRealTimePercurso.values()) {
        try {
            let coordenadas = [];
            if (rota.COORDENADAS.length > 1) {
                for (let coord of rota.COORDENADAS) {
                    coordenadas.push([coord.longitude, coord.latitude]);
                }
                let lineString = turf.lineString(coordenadas);
                let geojson = turf.toMercator(lineString);
    
                let rotaGeoJSON = (new ol.format.GeoJSON()).readFeatures(geojson);
                camadaVeiculos.source.addFeatures(rotaGeoJSON);
    
                // Plota veiculo
                let veiculoJSON = rota;
                let ultimaCoordenada = rota.COORDENADAS.length - 1;
                veiculoJSON["LOC_LONGITUDE"] = coordenadas[ultimaCoordenada][0];
                veiculoJSON["LOC_LATITUDE"] = coordenadas[ultimaCoordenada][1];
    
                veiculoJSON.NOME = "Veículo";
                veiculoJSON.MODELOSTR = "Não informado";
                veiculoJSON.ORIGEM = "Não informado";
                veiculoJSON.TIPOSTR = "Não informado";
    
                if (veiculoJSON.ID_VEICULO != "DESCONHECIDO") {
                    let v = hashMapVeiculos.get(veiculoJSON.ID_VEICULO);
                    if (v) {
                        let vJSON = parseVeiculoDB(v);
                        veiculoJSON.NOME = vJSON.MODELOSTR;
                        veiculoJSON.MODELOSTR = vJSON.MODELOSTR;
                        veiculoJSON.ORIGEM = vJSON.ORIGEM;
                        veiculoJSON.TIPOSTR = vJSON.TIPOSTR;
                    }
                }
    
                camadaVeiculos.source.addFeature(plotarVeiculo(veiculoJSON));
            }
        } catch (error) {
            console.error("ERROR", error)
        }
    }
}

function ouveUpdates() {
    let dataDeHoje = new Date().toISOString().split("T")[0];
    if (firebaseImpl) {
        firebaseImpl.dbAcessarDados(DB_TABLE_REALTIME_VIAGENSPERCURSO).where("DATA", "==", dataDeHoje)
            .onSnapshot((querySnapshot) => {
                querySnapshot.forEach((doc) => {
                    let viagemPercurso = doc.data();
                    if (viagemPercurso.TIPO_VEICULO && viagemPercurso.COORDENADAS &&
                        viagemPercurso.NOME_ROTA && viagemPercurso.NOME_MOTORISTA) {
                        hashMapRealTimePercurso.set(viagemPercurso.ID, viagemPercurso);
                    }
                });

                if (camadaVeiculos) {
                    camadaVeiculos.source.clear();
                    processaDadosPercurso();
                }
            });

        firebaseImpl.dbAcessarDados(DB_TABLE_REALTIME_VIAGENSALERTA).where("DATA", "==", dataDeHoje)
            .onSnapshot((querySnapshot) => {
                querySnapshot.forEach((doc) => {
                    let alerta = doc.data();
                    hashMapRealTimeAlerta.set(alerta["ID"], alerta);
                });

                if (camadaAlertas) {
                    camadaAlertas.source.clear();
                    processaDadosAlerta();
                }
            });
    }
}
