// mobi_local.js
// Modo local do SETE para importar e consultar dados gerados pelo MOBI.

(function () {
    const MOBI_LOCAL_USER_ID = "mobi-local-user";
    const MOBI_LOCAL_READONLY_MSG = "O modo local/MOBI da v1 permite importar e consultar dados. Edicoes manuais ficam para uma fase posterior.";
    let mobiLocalSchemaPromise = null;
    let mobiLocalReadyPromise = null;

    const COLLECTION_TABLES = {
        "alunos": { table: "Alunos", id: "ID_ALUNO", restId: "id_aluno" },
        "escolas": { table: "Escolas", id: "ID_ESCOLA", restId: "id_escola" },
        "rotas": { table: "Rotas", id: "ID_ROTA", restId: "id_rota" },
        "veiculos": { table: "Veiculos", id: "ID_VEICULO", restId: "id_veiculo" },
        "motoristas": { table: "Motoristas", id: "CPF", restId: "cpf" },
        "monitores": { table: "Monitores", id: "CPF", restId: "cpf" },
        "garagens": { table: "Garagem", id: "ID_GARAGEM", restId: "id_garagem" },
        "fornecedores": { table: "Fornecedores", id: "ID_FORNECEDOR", restId: "id_fornecedor" },
        "ordens-servicos": { table: "OrdemDeServico", id: null, restId: "id_ordem" },
        "parametros": { table: "Parametros", id: "CODIGO_PARAMETRO", restId: "codigo_parametro" },
    };

    function isMobiLocalMode() {
        if (!userconfig) return false;
        let value = userconfig.get("MOBI_LOCAL_MODE");
        return value === true || value === "true" || value === "1";
    }

    function requireElectronLocalMode() {
        if (!window.process || !knex) {
            throw new Error("O modo local/MOBI esta disponivel apenas no aplicativo desktop.");
        }
    }

    function normalizeKey(value) {
        return String(value || "").trim().toLowerCase();
    }

    function normalizeExternalId(value) {
        if (value === undefined || value === null || value === "") return null;
        return String(value);
    }

    function valueFrom(obj, keys, fallback = null) {
        for (let key of keys) {
            if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
                return obj[key];
            }
        }
        return fallback;
    }

    function numberFrom(value, fallback = 0) {
        if (value === undefined || value === null || value === "") return fallback;
        if (typeof value === "number") return value;
        let parsed = Number(String(value).replace(",", "."));
        return Number.isNaN(parsed) ? fallback : parsed;
    }

    function stringFrom(value, fallback = "") {
        if (value === undefined || value === null) return fallback;
        return String(value);
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function yn(value, fallback = "N") {
        if (value === undefined || value === null || value === "") return fallback;
        if (value === "S" || value === true || value === 1 || value === "1") return "S";
        if (String(value).toLowerCase() === "true" || String(value).toLowerCase() === "sim") return "S";
        return "N";
    }

    function lowerRow(row, idField = null, restId = null) {
        if (!row) return {};
        let out = {};
        for (let key of Object.keys(row)) {
            out[key.toLowerCase()] = row[key];
        }
        if (idField && restId && row[idField] !== undefined) {
            out[restId] = row[idField];
            out.id = row[idField];
        }
        return out;
    }

    function localRowFallback(collection, id = null) {
        let meta = COLLECTION_TABLES[collection];
        let out = {};
        if (meta && meta.restId && id !== null && id !== undefined) {
            out[meta.restId] = id;
            out.id = id;
        }
        if (collection === "rotas") {
            let routeId = id !== null && id !== undefined ? id : "";
            out.id_rota = routeId;
            out.nome = routeId !== "" ? `Rota ${routeId}` : "Rota sem nome";
            out.km = 0;
            out.tempo = 0;
            out.tipo = 1;
            out.shape = null;
            out.qtd_alunos = 0;
            out.qtd_escolas = 0;
        }
        return out;
    }

    function normalizeLocalRow(collection, row, id = null) {
        let meta = COLLECTION_TABLES[collection];
        if (!row) return localRowFallback(collection, id);

        let out = lowerRow(row, meta ? meta.id : null, meta ? meta.restId : null);
        if (collection === "rotas") {
            let routeId = out.id_rota || out.id || id || "";
            out.id_rota = routeId;
            out.id = routeId;
            out.nome = stringFrom(out.nome || row.NOME, routeId !== "" ? `Rota ${routeId}` : "Rota sem nome");
            out.km = out.km || 0;
            out.tempo = out.tempo || 0;
            out.tipo = out.tipo || 1;
            out.shape = out.shape || row.SHAPE || null;
            out.qtd_alunos = out.qtd_alunos || 0;
            out.qtd_escolas = out.qtd_escolas || 0;
        }
        return out;
    }

    function rowsWithData(rows) {
        let arr = rows || [];
        arr.data = arr;
        return arr;
    }

    function hashPayload(payload) {
        const crypto = require("crypto");
        return crypto.createHash("sha256")
            .update(JSON.stringify(payload || {}))
            .digest("hex");
    }

    async function ensureColumn(table, column, type) {
        let columns = await knex.raw(`PRAGMA table_info(${table})`);
        let found = columns.some((info) => info.name === column);
        if (!found) {
            await knex.schema.table(table, (t) => {
                t.specificType(column, type);
            });
        }
    }

    async function mobiLocalEnsureSchema() {
        if (mobiLocalSchemaPromise) return mobiLocalSchemaPromise;

        mobiLocalSchemaPromise = mobiLocalEnsureSchemaImpl()
            .catch((err) => {
                mobiLocalSchemaPromise = null;
                throw err;
            });

        return mobiLocalSchemaPromise;
    }

    async function mobiLocalEnsureSchemaImpl() {
        requireElectronLocalMode();

        let hasMonitores = await knex.schema.hasTable("Monitores");
        if (!hasMonitores) {
            await knex.schema.createTable("Monitores", (table) => {
                table.text("CPF").primary();
                table.text("NOME").notNullable();
                table.text("DATA_NASCIMENTO");
                table.text("SEXO");
                table.text("TELEFONE");
                table.integer("VINCULO");
                table.real("SALARIO");
                table.text("TURNO_MANHA").defaultTo("N");
                table.text("TURNO_TARDE").defaultTo("N");
                table.text("TURNO_NOITE").defaultTo("N");
            });
        }

        let hasRotaMonitor = await knex.schema.hasTable("RotaMonitoradaPorMonitor");
        if (!hasRotaMonitor) {
            await knex.schema.createTable("RotaMonitoradaPorMonitor", (table) => {
                table.integer("ID_ROTA").notNullable();
                table.text("CPF_MONITOR").notNullable();
                table.primary(["ID_ROTA", "CPF_MONITOR"]);
            });
        }

        let hasSyncMap = await knex.schema.hasTable("mobi_sync_map");
        if (!hasSyncMap) {
            await knex.schema.createTable("mobi_sync_map", (table) => {
                table.increments("id").primary();
                table.text("entity_type").notNullable();
                table.text("mobi_id").notNullable();
                table.text("sete_local_id").notNullable();
                table.text("payload_hash").notNullable();
                table.text("last_imported_at").notNullable();
                table.unique(["entity_type", "mobi_id"]);
            });
        }

        let hasImportLog = await knex.schema.hasTable("mobi_import_log");
        if (!hasImportLog) {
            await knex.schema.createTable("mobi_import_log", (table) => {
                table.increments("id").primary();
                table.text("imported_at").notNullable();
                table.text("schema_version");
                table.integer("mec_co_municipio");
                table.integer("mec_co_uf");
                table.text("summary_json");
                table.text("warnings_json");
            });
        }

        let hasParametros = await knex.schema.hasTable("Parametros");
        if (!hasParametros) {
            await knex.schema.createTable("Parametros", (table) => {
                table.text("CODIGO_PARAMETRO").primary();
                table.text("MODULO");
                table.text("VALOR");
            });
        }

        await ensureColumn("Motoristas", "VINCULO", "INTEGER");
        await ensureColumn("Motoristas", "SALARIO", "REAL");
        await ensureColumn("Motoristas", "DATA_VALIDADE_CNH", "TEXT");

        await ensureColumn("Veiculos", "TIPO_COMBUSTIVEL", "TEXT");
        await ensureColumn("Veiculos", "OUTRO_TIPO_TEXT", "TEXT");
        await ensureColumn("Veiculos", "NUMERO_DE_PNEUS", "INTEGER");
        await ensureColumn("Veiculos", "VIDA_UTIL_DO_PNEU", "REAL");
        await ensureColumn("Veiculos", "POTENCIA_DO_MOTOR", "REAL");
        await ensureColumn("Veiculos", "PRECO", "REAL");
        await ensureColumn("Veiculos", "IPVA", "REAL");
        await ensureColumn("Veiculos", "DPVAT", "REAL");
        await ensureColumn("Veiculos", "SEGURO_ANUAL", "REAL");
        await ensureColumn("Veiculos", "CONSUMO", "REAL");
    }

    async function resolveMunicipio(mecCoMunicipio) {
        requireElectronLocalMode();
        let codigo = Number(mecCoMunicipio);
        if (!codigo) throw new Error("Informe o codigo IBGE do municipio.");

        let rows = await knex("IBGE_Municipios")
            .select("IBGE_Municipios.*", "IBGE_Estados.uf", "IBGE_Estados.nome AS estado_nome")
            .leftJoin("IBGE_Estados", "IBGE_Municipios.codigo_uf", "IBGE_Estados.codigo_uf")
            .where("codigo_ibge", codigo);

        if (!rows.length) {
            throw new Error(`Municipio IBGE ${codigo} nao encontrado na base local do SETE.`);
        }

        return rows[0];
    }

    async function setMobiLocalUserConfig(cityCode, displayName = "MOBI Local") {
        let municipio = await resolveMunicipio(cityCode);
        let estadoNome = municipio.estado_nome || municipio.uf || String(municipio.codigo_uf);
        let dadoUsuario = {
            ID: MOBI_LOCAL_USER_ID,
            NOME: displayName,
            EMAIL: "mobi-local@localhost",
            CPF: "",
            TELEFONE: "",
            CIDADE: municipio.nome,
            ESTADO: estadoNome,
            COD_CIDADE: Number(municipio.codigo_ibge),
            COD_ESTADO: Number(municipio.codigo_uf),
            TOKEN: "MOBI_LOCAL_TOKEN"
        };

        userconfig.set("MOBI_LOCAL_MODE", true);
        userconfig.set("CIDADE", municipio.nome);
        userconfig.set("ESTADO", estadoNome);
        userconfig.set("COD_CIDADE", String(municipio.codigo_ibge));
        userconfig.set("COD_ESTADO", String(municipio.codigo_uf));
        userconfig.set("LATITUDE", Number(municipio.latitude));
        userconfig.set("LONGITUDE", Number(municipio.longitude));
        userconfig.set("ID", MOBI_LOCAL_USER_ID);
        userconfig.set("TIPO_PERMISSAO", "mobi_local");
        userconfig.set("NOME", displayName);
        userconfig.set("TOKEN", "MOBI_LOCAL_TOKEN");
        userconfig.set("DADO_USUARIO", JSON.stringify(dadoUsuario));
        userconfig.set("MOBI_LOCAL_LAST_CITY", String(municipio.codigo_ibge));
    }

    function clearMobiLocalMode() {
        if (!userconfig) return;
        userconfig.delete("MOBI_LOCAL_MODE");
    }

    async function mobiLocalPromptLogin() {
        try {
            requireElectronLocalMode();
            await mobiLocalEnsureSchema();
        } catch (err) {
            errorFn("Modo local indisponivel", err);
            return;
        }

        let lastCity = userconfig.get("MOBI_LOCAL_LAST_CITY") || userconfig.get("COD_CIDADE") || "";
        let lastName = userconfig.get("NOME") || "MOBI Local";

        let result = await Swal2.fire({
            title: "Entrar em modo local/MOBI",
            html: `
                <div class="text-left">
                    <label><b>Nome do usuario local</b></label>
                    <input id="mobiLocalName" class="swal2-input" value="${escapeHtml(lastName)}">
                    <label><b>Codigo IBGE do municipio</b></label>
                    <input id="mobiLocalCityCode" class="swal2-input" value="${escapeHtml(lastCity)}" placeholder="Ex.: 2304400">
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: "Entrar",
            cancelButtonText: "Cancelar",
            preConfirm: async () => {
                let name = document.getElementById("mobiLocalName").value.trim() || "MOBI Local";
                let cityCode = document.getElementById("mobiLocalCityCode").value.trim();
                try {
                    await setMobiLocalUserConfig(cityCode, name);
                    return true;
                } catch (err) {
                    Swal2.showValidationMessage(err.message);
                    return false;
                }
            }
        });

        if (result.value) {
            document.location.href = "./dashboard.html";
        }
    }

    async function tableRows(collection) {
        let meta = COLLECTION_TABLES[collection];
        if (!meta) return [];
        let rows = await knex(meta.table).select();
        return rows.map((row) => normalizeLocalRow(collection, row));
    }

    async function listAlunos() {
        let alunos = await knex("Alunos").select();
        let escolas = await knex("Escolas").select();
        let rotas = await knex("Rotas").select();
        let escolaRel = await knex("EscolaTemAlunos").select();
        let rotaRel = await knex("RotaAtendeAluno").select();

        return alunos.map((row) => {
            let out = normalizeLocalRow("alunos", row);
            let relEscola = escolaRel.find((rel) => Number(rel.ID_ALUNO) === Number(row.ID_ALUNO));
            let escola = relEscola ? escolas.find((item) => Number(item.ID_ESCOLA) === Number(relEscola.ID_ESCOLA)) : null;
            let relRotas = rotaRel.filter((rel) => Number(rel.ID_ALUNO) === Number(row.ID_ALUNO));
            let nomesRotas = relRotas
                .map((rel) => rotas.find((item) => Number(item.ID_ROTA) === Number(rel.ID_ROTA)))
                .filter(Boolean)
                .map((rota) => rota.NOME);
            out.escola = escola ? escola.NOME || escola.MEC_NO_ENTIDADE : "Nao Informada";
            out.rota = nomesRotas.length ? nomesRotas.join(", ") : "Nao Informada";
            return out;
        });
    }

    async function listEscolas() {
        let escolas = await knex("Escolas").select();
        let rels = await knex("EscolaTemAlunos").select();
        return escolas.map((row) => {
            let out = normalizeLocalRow("escolas", row);
            out.qtd_alunos = rels.filter((rel) => Number(rel.ID_ESCOLA) === Number(row.ID_ESCOLA)).length;
            return out;
        });
    }

    async function listRotas() {
        let rotas = await knex("Rotas").select();
        let alunosRel = await knex("RotaAtendeAluno").select();
        let escolasRel = await knex("RotaPassaPorEscolas").select();
        return rotas.map((row) => {
            let out = normalizeLocalRow("rotas", row);
            out.shape = row.SHAPE;
            out.qtd_alunos = alunosRel.filter((rel) => Number(rel.ID_ROTA) === Number(row.ID_ROTA)).length;
            out.qtd_escolas = escolasRel.filter((rel) => Number(rel.ID_ROTA) === Number(row.ID_ROTA)).length;
            return out;
        });
    }

    async function getByCollection(collection, id) {
        let meta = COLLECTION_TABLES[collection];
        if (!meta || !meta.id) return null;
        let rows = await knex(meta.table).select().where(meta.id, id);
        if (!rows.length && !Number.isNaN(Number(id))) {
            rows = await knex(meta.table).select().where(meta.id, Number(id));
        }
        return rows.length ? normalizeLocalRow(collection, rows[0], id) : localRowFallback(collection, id);
    }

    async function getAlunosByEscola(idEscola) {
        let rels = await knex("EscolaTemAlunos").select().where("ID_ESCOLA", Number(idEscola));
        let ids = rels.map((rel) => rel.ID_ALUNO);
        if (!ids.length) return rowsWithData([]);
        let rows = await knex("Alunos").select().whereIn("ID_ALUNO", ids);
        return rowsWithData(rows.map((row) => normalizeLocalRow("alunos", row)));
    }

    async function getEscolaByAluno(idAluno) {
        let rel = await knex("EscolaTemAlunos").select().where("ID_ALUNO", Number(idAluno)).first();
        if (!rel) return null;
        return getByCollection("escolas", rel.ID_ESCOLA);
    }

    async function getRotasByAluno(idAluno) {
        let rels = await knex("RotaAtendeAluno").select().where("ID_ALUNO", Number(idAluno));
        return rowsWithData(rels.map((rel) => ({ id_rota: rel.ID_ROTA })));
    }

    async function getAlunosByRota(idRota) {
        let rels = await knex("RotaAtendeAluno").select().where("ID_ROTA", Number(idRota));
        let ids = rels.map((rel) => rel.ID_ALUNO);
        if (!ids.length) return rowsWithData([]);
        let rows = await knex("Alunos").select().whereIn("ID_ALUNO", ids);
        return rowsWithData(rows.map((row) => normalizeLocalRow("alunos", row)));
    }

    async function getEscolasByRota(idRota) {
        let rels = await knex("RotaPassaPorEscolas").select().where("ID_ROTA", Number(idRota));
        let ids = rels.map((rel) => rel.ID_ESCOLA);
        if (!ids.length) return rowsWithData([]);
        let rows = await knex("Escolas").select().whereIn("ID_ESCOLA", ids);
        return rowsWithData(rows.map((row) => normalizeLocalRow("escolas", row)));
    }

    async function getVeiculosByRota(idRota) {
        let rels = await knex("RotaPossuiVeiculo").select().where("ID_ROTA", Number(idRota));
        let ids = rels.map((rel) => rel.ID_VEICULO);
        if (!ids.length) return rowsWithData([]);
        let rows = await knex("Veiculos").select().whereIn("ID_VEICULO", ids);
        let mapped = rows.map((row) => {
            let out = normalizeLocalRow("veiculos", row);
            out.id_veiculo = row.ID_VEICULO;
            return out;
        });
        return rowsWithData(mapped);
    }

    async function getMotoristasByRota(idRota) {
        let rels = await knex("RotaDirigidaPorMotorista").select().where("ID_ROTA", Number(idRota));
        let cpfs = rels.map((rel) => rel.CPF_MOTORISTA);
        if (!cpfs.length) return rowsWithData([]);
        let rows = await knex("Motoristas").select().whereIn("CPF", cpfs);
        let mapped = rows.map((row) => {
            let out = normalizeLocalRow("motoristas", row);
            out.cpf_motorista = row.CPF;
            return out;
        });
        return rowsWithData(mapped);
    }

    async function getMonitoresByRota(idRota) {
        let rels = await knex("RotaMonitoradaPorMonitor").select().where("ID_ROTA", Number(idRota));
        let cpfs = rels.map((rel) => rel.CPF_MONITOR);
        if (!cpfs.length) return rowsWithData([]);
        let rows = await knex("Monitores").select().whereIn("CPF", cpfs);
        let mapped = rows.map((row) => {
            let out = normalizeLocalRow("monitores", row);
            out.cpf_monitor = row.CPF;
            return out;
        });
        return rowsWithData(mapped);
    }

    async function getRotasByMonitor(cpf) {
        let rows = await knex("RotaMonitoradaPorMonitor").select().where("CPF_MONITOR", cpf);
        return rowsWithData(rows.map((rel) => ({ id_rota: rel.ID_ROTA })));
    }

    async function getRotasByMotorista(cpf) {
        let rows = await knex("RotaDirigidaPorMotorista").select().where("CPF_MOTORISTA", cpf);
        return rowsWithData(rows.map((rel) => ({ id_rota: rel.ID_ROTA })));
    }

    async function getRouteShape(idRota) {
        let row = await knex("Rotas").select("SHAPE").where("ID_ROTA", Number(idRota)).first();
        if (!row || !row.SHAPE) return { shape: null };
        return { shape: row.SHAPE };
    }

    async function getLocalCollection(collection, path = "") {
        await mobiLocalEnsureSchema();
        let parts = String(path || "").split("/").filter(Boolean);

        if (collection === "alunos" && !parts.length) return rowsWithData(await listAlunos());
        if (collection === "escolas" && !parts.length) return rowsWithData(await listEscolas());
        if (collection === "rotas" && !parts.length) return rowsWithData(await listRotas());

        if (collection === "rotas" && parts.length === 2 && parts[1] === "alunos") return getAlunosByRota(parts[0]);
        if (collection === "rotas" && parts.length === 2 && parts[1] === "escolas") return getEscolasByRota(parts[0]);
        if (collection === "rotas" && parts.length === 2 && parts[1] === "veiculos") return getVeiculosByRota(parts[0]);
        if (collection === "rotas" && parts.length === 2 && parts[1] === "motoristas") return getMotoristasByRota(parts[0]);
        if (collection === "rotas" && parts.length === 2 && parts[1] === "monitores") return getMonitoresByRota(parts[0]);
        if (collection === "monitores" && parts.length === 2 && parts[1] === "rota") return getRotasByMonitor(parts[0]);
        if (collection === "motoristas" && parts.length === 2 && parts[1] === "rota") return getRotasByMotorista(parts[0]);

        return rowsWithData(await tableRows(collection));
    }

    async function getLocalEntity(collection, path = "") {
        await mobiLocalEnsureSchema();
        let parts = String(path || "").split("/").filter(Boolean);
        if (!parts.length) return localRowFallback(collection);

        if (collection === "alunos" && parts.length === 2 && parts[1] === "escola") return getEscolaByAluno(parts[0]);
        if (collection === "alunos" && parts.length === 2 && parts[1] === "rota") return getRotasByAluno(parts[0]);
        if (collection === "escolas" && parts.length === 2 && parts[1] === "alunos") return getAlunosByEscola(parts[0]);
        if (collection === "rotas" && parts.length === 2 && parts[1] === "shape") return getRouteShape(parts[0]);
        if (collection === "rotas" && ["alunos", "escolas", "veiculos", "motoristas", "monitores"].includes(parts[1])) {
            return getLocalCollection(collection, path);
        }
        if (collection === "graficos") return getLocalGraficos(parts[0]);

        return getByCollection(collection, parts[0]);
    }

    function groupCount(rows, getter) {
        let map = new Map();
        rows.forEach((row) => {
            let key = getter(row) || "Nao informado";
            map.set(key, (map.get(key) || 0) + 1);
        });
        return {
            labels: Array.from(map.keys()),
            values: Array.from(map.values())
        };
    }

    async function getLocalGraficos(type) {
        let data = [];
        if (type === "alunos") {
            let alunos = await listAlunos();
            let sexo = groupCount(alunos, (a) => ({ 1: "Masculino", 2: "Feminino", 3: "Nao informado" }[Number(a.sexo)]));
            let turno = groupCount(alunos, (a) => ({ 1: "Manha", 2: "Tarde", 3: "Integral", 4: "Noite" }[Number(a.turno)]));
            data = [
                { nome: "Atendimento", titulo: "Atendimento", labels: ["Alunos"], values: [alunos.length] },
                { nome: "Sexo", titulo: "Sexo", labels: sexo.labels, values: sexo.values },
                { nome: "Turno de Aula", titulo: "Turno de Aula", labels: turno.labels, values: turno.values }
            ];
        } else if (type === "escolas") {
            let escolas = await listEscolas();
            let loc = groupCount(escolas, (e) => Number(e.mec_tp_localizacao) === 2 ? "Rural" : "Urbana");
            data = [
                { nome: "Localidade", titulo: "Localidade", labels: loc.labels, values: loc.values },
                { nome: "Total de Escolas", titulo: "Total de Escolas", labels: ["Escolas"], values: [escolas.length] }
            ];
        } else if (type === "veiculos") {
            let veiculos = await tableRows("veiculos");
            let origem = groupCount(veiculos, (v) => Number(v.origem) === 1 ? "Proprio" : "Terceirizado");
            data = [
                { nome: "Lotação Média", titulo: "Lotacao Media", labels: ["Lugares"], values: [veiculos.length ? veiculos.reduce((sum, v) => sum + Number(v.capacidade || 0), 0) / veiculos.length : 0] },
                { nome: "Origem dos veículos", titulo: "Origem dos Veiculos", labels: origem.labels, values: origem.values }
            ];
        } else if (type === "rotas") {
            let rotas = await listRotas();
            data = [
                { nome: "Total de Rotas", titulo: "Total de Rotas", labels: ["Rotas"], values: [rotas.length] },
                { nome: "Quilometragem", titulo: "Quilometragem", labels: ["Km"], values: [rotas.reduce((sum, r) => sum + Number(r.km || 0), 0)] }
            ];
        }
        return { data };
    }

    function blockedLocalWrite() {
        return Promise.reject({
            response: {
                data: {
                    messages: MOBI_LOCAL_READONLY_MSG
                }
            },
            message: MOBI_LOCAL_READONLY_MSG
        });
    }

    function installMobiLocalRestAdapter() {
        if (!isMobiLocalMode() || !restImpl) return;

        restImpl.dbGETColecao = (nomeColecao, path = "") => getLocalCollection(nomeColecao, path);
        restImpl.dbGETEntidade = (nomeColecao, path = "") => getLocalEntity(nomeColecao, path);
        restImpl.dbBuscarTodosDadosPromise = (nomeColecao) => getLocalCollection(nomeColecao, "");
        restImpl.dbBuscarTodosDadosNoServidorPromise = (nomeColecao) => getLocalCollection(nomeColecao, "");
        restImpl.dbBuscarDadosEspecificosPromise = (nomeColecao, path) => getLocalEntity(nomeColecao, "/" + path);
        restImpl.dbGETRaiz = () => Promise.resolve({ data: [] });
        restImpl.dbGETColecaoRaiz = () => Promise.resolve({ data: [] });
        restImpl.dbPOST = blockedLocalWrite;
        restImpl.dbPUT = blockedLocalWrite;
        restImpl.dbDELETE = blockedLocalWrite;
        restImpl.dbDELETEComParam = blockedLocalWrite;
        restImpl.dbAtualizarPromise = blockedLocalWrite;
    }

    function getMobiLocalReady() {
        if (!isMobiLocalMode()) {
            return Promise.resolve(false);
        }
        if (!mobiLocalReadyPromise) {
            mobiLocalReadyPromise = Promise.resolve()
                .then(() => {
                    requireElectronLocalMode();
                    installMobiLocalRestAdapter();
                    return mobiLocalEnsureSchema();
                })
                .then(() => {
                    installMobiLocalRestAdapter();
                    return true;
                })
                .catch((err) => {
                    mobiLocalReadyPromise = null;
                    throw err;
                });
        }
        return mobiLocalReadyPromise;
    }

    function entitiesFromManifest(manifest, key, aliases = []) {
        let roots = [manifest.entities, manifest.data, manifest];
        for (let root of roots) {
            if (!root) continue;
            for (let name of [key, ...aliases]) {
                if (Array.isArray(root[name])) return root[name];
            }
        }
        return [];
    }

    function externalId(entity) {
        return normalizeExternalId(valueFrom(entity, ["external_id", "mobi_id", "id", "uuid", "pk"]));
    }

    function mapLocation(value) {
        let normalized = normalizeKey(value);
        if (value === 2 || normalized.includes("rural")) return 2;
        return 1;
    }

    function mapGender(value) {
        let normalized = normalizeKey(value);
        if (value === 1 || normalized === "m" || normalized.includes("masc")) return 1;
        if (value === 2 || normalized === "f" || normalized.includes("fem")) return 2;
        return 3;
    }

    function mapRace(value) {
        let normalized = normalizeKey(value);
        if (value === 1 || normalized.includes("branco")) return 1;
        if (value === 2 || normalized.includes("preto")) return 2;
        if (value === 3 || normalized.includes("pardo")) return 3;
        if (value === 4 || normalized.includes("amarelo")) return 4;
        if (value === 5 || normalized.includes("indig")) return 5;
        return 6;
    }

    function mapShift(value) {
        let normalized = normalizeKey(value);
        if (value === 2 || normalized.includes("tarde")) return 2;
        if (value === 3 || normalized.includes("integral")) return 3;
        if (value === 4 || normalized.includes("noite") || normalized.includes("noturno")) return 4;
        return 1;
    }

    function mapEducationStage(value) {
        let normalized = normalizeKey(value);
        if (value === 1 || normalized.includes("infantil") || normalized.includes("ed_infantil")) return 1;
        if (value === 3 || normalized.includes("medio") || normalized.includes("ens_medio")) return 3;
        if (value === 4 || normalized.includes("superior")) return 4;
        if (value === 5 || normalized.includes("outro")) return 5;
        return 2;
    }

    function mapRouteType(value) {
        let normalized = normalizeKey(value);
        if (value === 2 || normalized.includes("water") || normalized.includes("aqua")) return 2;
        if (value === 3 || normalized.includes("mixed") || normalized.includes("mista")) return 3;
        return 1;
    }

    function mapVehicleType(value) {
        if (value !== undefined && value !== null && !Number.isNaN(Number(value))) return Number(value);
        let normalized = normalizeKey(value);
        if (normalized.includes("micro")) return 2;
        if (normalized.includes("van")) return 3;
        if (normalized.includes("kombi")) return 4;
        if (normalized.includes("lancha")) return 9;
        if (normalized.includes("barco")) return 10;
        if (normalized.includes("canoa")) return 12;
        return 1;
    }

    function mapVehicleOrigin(value) {
        let normalized = normalizeKey(value);
        if (value === 2 || normalized.includes("third") || normalized.includes("terc")) return 2;
        return 1;
    }

    function mapVehicleMode(value) {
        let normalized = normalizeKey(value);
        if (value === 1 || normalized.includes("water") || normalized.includes("aqua")) return 1;
        return 0;
    }

    function mapCnhFlags(category) {
        let raw = String(category || "").toUpperCase();
        return {
            TEM_CNH_A: raw.includes("A") ? "S" : "N",
            TEM_CNH_B: raw.includes("B") ? "S" : "N",
            TEM_CNH_C: raw.includes("C") ? "S" : "N",
            TEM_CNH_D: raw.includes("D") ? "S" : "N",
            TEM_CNH_E: raw.includes("E") ? "S" : "N",
        };
    }

    function normalizeShape(route) {
        let shape = valueFrom(route, ["shape_geojson", "geometry_json", "geojson", "shape"]);
        if (!shape) return null;
        let parsed = typeof shape === "string" ? JSON.parse(shape) : shape;
        if (parsed.type === "FeatureCollection") return JSON.stringify(parsed);
        if (parsed.type === "Feature") return JSON.stringify({ type: "FeatureCollection", features: [parsed] });
        if (parsed.type === "LineString" || parsed.type === "MultiLineString") {
            return JSON.stringify({
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { TIPO: "ROTA" }, geometry: parsed }]
            });
        }
        return null;
    }

    function relationIds(entity, keys) {
        let values = [];
        for (let key of keys) {
            let raw = entity[key];
            if (Array.isArray(raw)) values.push(...raw);
            else if (raw !== undefined && raw !== null && raw !== "") values.push(raw);
        }
        return values.map((item) => {
            if (typeof item === "object") {
                return externalId(item) || normalizeExternalId(valueFrom(item, [
                    "student_id", "school_id", "vehicle_id", "driver_id", "monitor_id",
                    "external_student_id", "external_school_id", "external_vehicle_id",
                    "external_driver_id", "external_monitor_id", "mobi_id", "id"
                ]));
            }
            return normalizeExternalId(item);
        }).filter(Boolean);
    }

    function buildSummary(manifest) {
        return {
            escolas: entitiesFromManifest(manifest, "schools", ["escolas"]).length,
            alunos: entitiesFromManifest(manifest, "students", ["alunos"]).length,
            veiculos: entitiesFromManifest(manifest, "vehicles", ["veiculos"]).length,
            motoristas: entitiesFromManifest(manifest, "drivers", ["motoristas"]).length,
            monitores: entitiesFromManifest(manifest, "monitors", ["monitores"]).length,
            garagens: entitiesFromManifest(manifest, "origin_points", ["garagens", "garages"]).length,
            rotas: entitiesFromManifest(manifest, "routes", ["rotas"]).length
        };
    }

    async function readManifestFromFile(filePath) {
        const fs = require("fs-extra");
        let buffer = fs.readFileSync(filePath);
        let text = buffer.toString("utf8").replace(/^\uFEFF/, "").trimStart();
        if (text.startsWith("{") || text.startsWith("[")) {
            return JSON.parse(text);
        }

        const unzipper = require("unzipper");
        let directory = await unzipper.Open.buffer(buffer);
        let manifestFile = directory.files.find((file) => file.path === "manifest.json" || file.path.endsWith("/manifest.json"));
        if (!manifestFile) {
            throw new Error("ZIP sem manifest.json.");
        }
        let content = await manifestFile.buffer();
        return JSON.parse(content.toString("utf8"));
    }

    async function insertSyncMap(trx, entityType, mobiId, seteLocalId, payload) {
        await trx("mobi_sync_map").insert({
            entity_type: entityType,
            mobi_id: String(mobiId),
            sete_local_id: String(seteLocalId),
            payload_hash: hashPayload(payload),
            last_imported_at: new Date().toISOString()
        });
    }

    async function importManifest(manifest) {
        await mobiLocalEnsureSchema();

        let client = manifest.client || manifest.municipio || {};
        let cityCode = valueFrom(client, ["mec_co_municipio", "codigo_ibge", "cod_cidade"], manifest.mec_co_municipio);
        let municipio = await resolveMunicipio(cityCode);
        let warnings = [];
        let imported = {
            escolas: 0,
            alunos: 0,
            veiculos: 0,
            motoristas: 0,
            monitores: 0,
            garagens: 0,
            rotas: 0
        };

        let escolas = entitiesFromManifest(manifest, "schools", ["escolas"]);
        let alunos = entitiesFromManifest(manifest, "students", ["alunos"]);
        let veiculos = entitiesFromManifest(manifest, "vehicles", ["veiculos"]);
        let motoristas = entitiesFromManifest(manifest, "drivers", ["motoristas"]);
        let monitores = entitiesFromManifest(manifest, "monitors", ["monitores"]);
        let garagens = entitiesFromManifest(manifest, "origin_points", ["garagens", "garages"]);
        let rotas = entitiesFromManifest(manifest, "routes", ["rotas"]);

        escolas.forEach((school) => {
            if (!valueFrom(school, ["inep_code", "mec_co_entidade", "co_entidade"])) {
                warnings.push(`Escola sem INEP: ${valueFrom(school, ["name", "nome"], externalId(school) || "sem identificador")}`);
            }
        });

        let mapEscolas = new Map();
        let mapAlunos = new Map();
        let mapVeiculos = new Map();
        let mapMotoristas = new Map();
        let mapMonitores = new Map();

        await knex.transaction(async (trx) => {
            await trx("RotaMonitoradaPorMonitor").del();
            await trx("RotaDirigidaPorMotorista").del();
            await trx("RotaPossuiVeiculo").del();
            await trx("RotaAtendeAluno").del();
            await trx("RotaPassaPorEscolas").del();
            await trx("EscolaTemAlunos").del();
            await trx("OrdemDeServico").del();
            await trx("Alunos").del();
            await trx("Escolas").del();
            await trx("Rotas").del();
            await trx("Veiculos").del();
            await trx("Motoristas").del();
            await trx("Monitores").del();
            await trx("Garagem").del();
            await trx("Fornecedores").del();
            await trx("Parametros").del();
            await trx("mobi_sync_map").del();

            for (let school of escolas) {
                let id = externalId(school);
                if (!id) continue;
                let shifts = valueFrom(school, ["shifts", "turnos"], []);
                let stages = valueFrom(school, ["stages", "etapas"], []);
                let stageText = JSON.stringify(stages).toLowerCase();
                let shiftText = JSON.stringify(shifts).toLowerCase();
                let row = {
                    NOME: valueFrom(school, ["name", "nome", "mec_no_entidade"], ""),
                    MEC_CO_ENTIDADE: numberFrom(valueFrom(school, ["inep_code", "mec_co_entidade", "co_entidade"]), null),
                    MEC_CO_UF: Number(municipio.codigo_uf),
                    MEC_CO_MUNICIPIO: Number(municipio.codigo_ibge),
                    MEC_NO_ENTIDADE: valueFrom(school, ["name", "nome", "mec_no_entidade"], ""),
                    MEC_TP_DEPENDENCIA: numberFrom(valueFrom(school, ["mec_tp_dependencia", "dependencia"]), 3),
                    MEC_TP_LOCALIZACAO: mapLocation(valueFrom(school, ["location", "localizacao", "mec_tp_localizacao"])),
                    MEC_IN_REGULAR: yn(valueFrom(school, ["mec_in_regular"], "S")),
                    MEC_IN_EJA: yn(valueFrom(school, ["mec_in_eja"], "N")),
                    MEC_IN_PROFISSIONALIZANTE: yn(valueFrom(school, ["mec_in_profissionalizante"], "N")),
                    MEC_IN_ESPECIAL_EXCLUSIVA: yn(valueFrom(school, ["mec_in_especial_exclusiva"], "N")),
                    LOC_LATITUDE: numberFrom(valueFrom(school, ["latitude", "loc_latitude"]), null),
                    LOC_LONGITUDE: numberFrom(valueFrom(school, ["longitude", "loc_longitude"]), null),
                    LOC_CEP: valueFrom(school, ["zip_code", "cep", "loc_cep"], null),
                    LOC_ENDERECO: valueFrom(school, ["address", "street", "loc_endereco"], null),
                    CONTATO_RESPONSAVEL: valueFrom(school, ["responsible_name", "contato_responsavel"], null),
                    CONTATO_TELEFONE: valueFrom(school, ["contact_phone", "phone", "contato_telefone"], null),
                    CONTATO_EMAIL: valueFrom(school, ["email", "contato_email"], null),
                    HORARIO_MATUTINO: shiftText.includes("manha") || shiftText.includes("matutino") ? "S" : "N",
                    HORARIO_VESPERTINO: shiftText.includes("tarde") || shiftText.includes("vespertino") ? "S" : "N",
                    HORARIO_NOTURNO: shiftText.includes("noite") || shiftText.includes("noturno") ? "S" : "N",
                    ENSINO_PRE_ESCOLA: stageText.includes("infantil") ? "S" : "N",
                    ENSINO_FUNDAMENTAL: stageText.includes("fund") ? "S" : "N",
                    ENSINO_MEDIO: stageText.includes("medio") ? "S" : "N",
                    ENSINO_SUPERIOR: stageText.includes("superior") ? "S" : "N",
                    MEC_TP_LOCALIZACAO_DIFERENCIADA: numberFrom(valueFrom(school, ["mec_tp_localizacao_diferenciada"]), 0)
                };
                let inserted = await trx("Escolas").insert(row);
                mapEscolas.set(id, inserted[0]);
                await insertSyncMap(trx, "escola", id, inserted[0], school);
                imported.escolas += 1;
            }

            for (let student of alunos) {
                let id = externalId(student);
                if (!id) continue;
                let row = {
                    LOC_LATITUDE: numberFrom(valueFrom(student, ["latitude", "loc_latitude"]), null),
                    LOC_LONGITUDE: numberFrom(valueFrom(student, ["longitude", "loc_longitude"]), null),
                    LOC_ENDERECO: valueFrom(student, ["address", "street", "loc_endereco"], null),
                    LOC_CEP: valueFrom(student, ["zip_code", "cep", "loc_cep"], null),
                    DA_PORTEIRA: "N",
                    DA_MATABURRO: "N",
                    DA_COLCHETE: "N",
                    DA_ATOLEIRO: "N",
                    DA_PONTERUSTICA: "N",
                    NOME: valueFrom(student, ["nome", "name"], ""),
                    DATA_NASCIMENTO: valueFrom(student, ["data_nascimento", "birth_date", "date_of_birth"], ""),
                    SEXO: mapGender(valueFrom(student, ["gender", "sexo"])),
                    COR: mapRace(valueFrom(student, ["raca", "race", "cor"])),
                    NOME_RESPONSAVEL: valueFrom(student, ["responsible", "nome_responsavel"], null),
                    GRAU_RESPONSAVEL: numberFrom(valueFrom(student, ["relationship", "grau_responsavel"]), 0),
                    TELEFONE_RESPONSAVEL: valueFrom(student, ["phone", "telefone_responsavel"], null),
                    DEF_CAMINHAR: "N",
                    DEF_OUVIR: "N",
                    DEF_ENXERGAR: "N",
                    DEF_MENTAL: "N",
                    TURNO: mapShift(valueFrom(student, ["shift", "turno"])),
                    NIVEL: mapEducationStage(valueFrom(student, ["education_stage", "nivel"])),
                    CPF: valueFrom(student, ["cpf"], null),
                    MEC_TP_LOCALIZACAO: mapLocation(valueFrom(student, ["location", "localizacao", "mec_tp_localizacao"]))
                };
                if (valueFrom(student, ["has_special_needs"], false)) {
                    warnings.push(`Aluno com necessidade especial sem classificacao SETE: ${row.NOME}`);
                }
                let inserted = await trx("Alunos").insert(row);
                mapAlunos.set(id, inserted[0]);
                await insertSyncMap(trx, "aluno", id, inserted[0], student);
                let schoolId = relationIds(student, ["school_id", "school", "external_school_id", "school_ids", "schools"])[0];
                if (schoolId && mapEscolas.has(schoolId)) {
                    await trx("EscolaTemAlunos").insert({ ID_ESCOLA: mapEscolas.get(schoolId), ID_ALUNO: inserted[0] });
                }
                imported.alunos += 1;
            }

            for (let vehicle of veiculos) {
                let id = externalId(vehicle);
                if (!id) continue;
                let row = {
                    PLACA: valueFrom(vehicle, ["license_plate", "placa"], ""),
                    MODELO: valueFrom(vehicle, ["model", "modelo"], ""),
                    ANO: stringFrom(valueFrom(vehicle, ["model_year", "manufacturing_year", "ano"], "")),
                    MODO: mapVehicleMode(valueFrom(vehicle, ["transport_mode", "mode", "modo"])),
                    ORIGEM: mapVehicleOrigin(valueFrom(vehicle, ["origin", "origem"])),
                    KM_INICIAL: numberFrom(valueFrom(vehicle, ["km_inicial", "odometer"]), null),
                    CAPACIDADE: numberFrom(valueFrom(vehicle, ["capacidade", "capacity"]), 0),
                    KM_ATUAL: numberFrom(valueFrom(vehicle, ["km_atual", "odometer"]), null),
                    TIPO: mapVehicleType(valueFrom(vehicle, ["vehicle_type", "tipo"])),
                    RENAVAM: valueFrom(vehicle, ["renavam"], null),
                    MANUTENCAO: yn(valueFrom(vehicle, ["maintenance", "manutencao"], "N")),
                    MARCA: valueFrom(vehicle, ["brand", "marca"], ""),
                    TIPO_COMBUSTIVEL: valueFrom(vehicle, ["combustivel", "tipo_combustivel"], null),
                    NUMERO_DE_PNEUS: numberFrom(valueFrom(vehicle, ["tire_count", "numero_de_pneus"]), null),
                    VIDA_UTIL_DO_PNEU: numberFrom(valueFrom(vehicle, ["tire_useful_life", "vida_util_do_pneu"]), null),
                    POTENCIA_DO_MOTOR: numberFrom(valueFrom(vehicle, ["engine_power", "potencia_do_motor"]), null),
                    PRECO: numberFrom(valueFrom(vehicle, ["vehicle_price", "preco"]), null)
                };
                let inserted = await trx("Veiculos").insert(row);
                mapVeiculos.set(id, inserted[0]);
                await insertSyncMap(trx, "veiculo", id, inserted[0], vehicle);
                imported.veiculos += 1;
            }

            for (let driver of motoristas) {
                let id = externalId(driver) || valueFrom(driver, ["cpf"]);
                let cpf = stringFrom(valueFrom(driver, ["cpf"], id)).replace(/\D/g, "");
                if (!cpf) continue;
                let cnhFlags = mapCnhFlags(valueFrom(driver, ["cnh_category", "categoria_cnh"]));
                let row = {
                    NOME: valueFrom(driver, ["name", "nome"], ""),
                    DATA_NASCIMENTO: valueFrom(driver, ["birth_date", "data_nascimento"], ""),
                    SEXO: mapGender(valueFrom(driver, ["gender", "sexo"])),
                    CPF: cpf,
                    TELEFONE: valueFrom(driver, ["phone", "telefone"], null),
                    CNH: valueFrom(driver, ["cnh_number", "cnh"], ""),
                    ANT_CRIMINAIS: valueFrom(driver, ["ant_criminais"], null),
                    ...cnhFlags,
                    TURNO_MANHA: "S",
                    TURNO_TARDE: "S",
                    TURNO_NOITE: "N",
                    VINCULO: numberFrom(valueFrom(driver, ["vinculo"]), null),
                    SALARIO: numberFrom(valueFrom(driver, ["salary", "salario"]), null),
                    DATA_VALIDADE_CNH: valueFrom(driver, ["cnh_valid_until", "data_validade_cnh"], null)
                };
                await trx("Motoristas").insert(row);
                mapMotoristas.set(String(id), cpf);
                mapMotoristas.set(String(cpf), cpf);
                await insertSyncMap(trx, "motorista", id, cpf, driver);
                imported.motoristas += 1;
            }

            for (let monitor of monitores) {
                let id = externalId(monitor) || valueFrom(monitor, ["cpf"]);
                let cpf = stringFrom(valueFrom(monitor, ["cpf"], id)).replace(/\D/g, "");
                if (!cpf) continue;
                let row = {
                    NOME: valueFrom(monitor, ["name", "nome"], ""),
                    DATA_NASCIMENTO: valueFrom(monitor, ["birth_date", "data_nascimento"], ""),
                    SEXO: mapGender(valueFrom(monitor, ["gender", "sexo"])),
                    CPF: cpf,
                    TELEFONE: valueFrom(monitor, ["phone", "telefone"], null),
                    VINCULO: numberFrom(valueFrom(monitor, ["vinculo"]), null),
                    SALARIO: numberFrom(valueFrom(monitor, ["salary", "salario"]), null),
                    TURNO_MANHA: "S",
                    TURNO_TARDE: "S",
                    TURNO_NOITE: "N"
                };
                await trx("Monitores").insert(row);
                mapMonitores.set(String(id), cpf);
                mapMonitores.set(String(cpf), cpf);
                await insertSyncMap(trx, "monitor", id, cpf, monitor);
                imported.monitores += 1;
            }

            for (let garage of garagens) {
                let id = externalId(garage);
                let lat = numberFrom(valueFrom(garage, ["latitude", "loc_latitude"]), null);
                let lon = numberFrom(valueFrom(garage, ["longitude", "loc_longitude"]), null);
                if (lat === null || lon === null) {
                    warnings.push(`Garagem/ponto de origem sem coordenadas: ${valueFrom(garage, ["name", "nome"], id || "sem identificador")}`);
                    continue;
                }
                let row = {
                    LOC_LATITUDE: lat,
                    LOC_LONGITUDE: lon,
                    LOC_ENDERECO: valueFrom(garage, ["address", "street", "loc_endereco"], null),
                    LOC_CEP: valueFrom(garage, ["zip_code", "cep", "loc_cep"], null)
                };
                let inserted = await trx("Garagem").insert(row);
                if (id) await insertSyncMap(trx, "garagem", id, inserted[0], garage);
                imported.garagens += 1;
            }

            for (let route of rotas) {
                let id = externalId(route);
                if (!id) continue;
                let shape = null;
                try {
                    shape = normalizeShape(route);
                } catch (err) {
                    warnings.push(`Shape invalido na rota ${valueFrom(route, ["name", "nome"], id)}: ${err.message}`);
                }
                if (!shape) warnings.push(`Rota sem shape importado: ${valueFrom(route, ["name", "nome"], id)}`);
                let row = {
                    NOME: valueFrom(route, ["name", "nome"], ""),
                    KM: String(numberFrom(valueFrom(route, ["distance", "km"]), 0)),
                    HORA_IDA_INICIO: valueFrom(route, ["hora_ida_inicio"], null),
                    HORA_IDA_TERMINO: valueFrom(route, ["hora_ida_termino"], null),
                    DA_PORTEIRA: "N",
                    DA_MATABURRO: "N",
                    DA_COLCHETE: "N",
                    DA_ATOLEIRO: "N",
                    DA_PONTERUSTICA: "N",
                    TURNO_MATUTINO: yn(valueFrom(route, ["turno_matutino"], "S")),
                    TURNO_VESPERTINO: yn(valueFrom(route, ["turno_vespertino"], "S")),
                    TURNO_NOTURNO: yn(valueFrom(route, ["turno_noturno"], "N")),
                    SHAPE: shape,
                    HORA_VOLTA_INICIO: valueFrom(route, ["hora_volta_inicio"], null),
                    HORA_VOLTA_TERMINO: valueFrom(route, ["hora_volta_termino"], null),
                    TEMPO: String(numberFrom(valueFrom(route, ["expected_duration", "duration", "tempo"]), 0)),
                    TIPO: mapRouteType(valueFrom(route, ["mode", "tipo"]))
                };
                let inserted = await trx("Rotas").insert(row);
                let localRouteId = inserted[0];
                await insertSyncMap(trx, "rota", id, localRouteId, route);

                let schoolIds = relationIds(route, ["school_id", "school", "external_school_id", "school_ids", "schools"]);
                for (let schoolId of schoolIds) {
                    if (mapEscolas.has(schoolId)) {
                        await trx("RotaPassaPorEscolas").insert({ ID_ROTA: localRouteId, ID_ESCOLA: mapEscolas.get(schoolId) });
                    }
                }

                let vehicleIds = relationIds(route, ["vehicle_id", "vehicle", "vehicles", "vehicle_ids"]);
                for (let vehicleId of vehicleIds) {
                    if (mapVeiculos.has(vehicleId)) {
                        await trx("RotaPossuiVeiculo").insert({ ID_ROTA: localRouteId, ID_VEICULO: mapVeiculos.get(vehicleId) });
                    }
                }

                let driverIds = relationIds(route, ["driver_id", "driver", "drivers", "driver_ids"]);
                for (let driverId of driverIds) {
                    if (mapMotoristas.has(driverId)) {
                        await trx("RotaDirigidaPorMotorista").insert({ ID_ROTA: localRouteId, CPF_MOTORISTA: mapMotoristas.get(driverId) });
                    }
                }

                let monitorIds = relationIds(route, ["monitor_id", "monitor", "monitors", "monitor_ids"]);
                for (let monitorId of monitorIds) {
                    if (mapMonitores.has(monitorId)) {
                        await trx("RotaMonitoradaPorMonitor").insert({ ID_ROTA: localRouteId, CPF_MONITOR: mapMonitores.get(monitorId) });
                    }
                }

                let studentIds = relationIds(route, ["student_ids", "students", "passengers", "route_passengers"]);
                for (let studentId of studentIds) {
                    if (mapAlunos.has(studentId)) {
                        await trx("RotaAtendeAluno").insert({ ID_ROTA: localRouteId, ID_ALUNO: mapAlunos.get(studentId) });
                    }
                }
                imported.rotas += 1;
            }

            for (let student of alunos) {
                let studentId = externalId(student);
                let localStudentId = mapAlunos.get(studentId);
                let routeIds = relationIds(student, ["route_id", "route", "routes", "route_ids"]);
                for (let routeId of routeIds) {
                    let routeMap = await trx("mobi_sync_map")
                        .select("sete_local_id")
                        .where({ entity_type: "rota", mobi_id: String(routeId) })
                        .first();
                    if (localStudentId && routeMap) {
                        await trx("RotaAtendeAluno")
                            .insert({ ID_ROTA: Number(routeMap.sete_local_id), ID_ALUNO: localStudentId })
                            .catch(() => null);
                    }
                }
            }

            await trx("mobi_import_log").insert({
                imported_at: new Date().toISOString(),
                schema_version: manifest.schema || manifest.schema_version || "mobi-sete-v1",
                mec_co_municipio: Number(municipio.codigo_ibge),
                mec_co_uf: Number(municipio.codigo_uf),
                summary_json: JSON.stringify(imported),
                warnings_json: JSON.stringify(warnings)
            });
        });

        await setMobiLocalUserConfig(municipio.codigo_ibge, userconfig.get("NOME") || "MOBI Local");
        installMobiLocalRestAdapter();

        return {
            imported,
            warnings,
            municipio
        };
    }

    window.isMobiLocalMode = isMobiLocalMode;
    window.mobiLocalEnsureSchema = mobiLocalEnsureSchema;
    window.mobiLocalPromptLogin = mobiLocalPromptLogin;
    window.mobiLocalClearMode = clearMobiLocalMode;
    window.mobiLocalReadManifestFromFile = readManifestFromFile;
    window.mobiLocalImportManifest = importManifest;
    window.mobiLocalBuildSummary = buildSummary;
    window.mobiLocalReadonlyMessage = MOBI_LOCAL_READONLY_MSG;
    window.installMobiLocalRestAdapter = installMobiLocalRestAdapter;
    window.mobiLocalEnsureReady = getMobiLocalReady;
    window.mobiLocalReady = isMobiLocalMode() ? getMobiLocalReady() : Promise.resolve(false);

    if (isMobiLocalMode()) {
        window.mobiLocalReady
            .catch((err) => console.error("Erro ao iniciar modo local/MOBI", err));
    }
})();
