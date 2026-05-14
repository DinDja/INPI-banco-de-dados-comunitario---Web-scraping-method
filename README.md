# INPI Patent Scraper

Robô que varre o portal [pePI do INPI](https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp) e constrói uma base de patentes local no formato **JSONL** (uma patente por linha).

---

## Pré-requisitos

```
Node.js >= 18
```

---

## Uso

### 1. Diagnóstico (primeira vez)

Rode o probe para verificar que o scraper detecta corretamente os campos do formulário:

```bash
node probe.js
```

Um browser **visível** será aberto. Observe no terminal o dump dos campos. Se os campos de data não forem detectados automaticamente, copie os valores `name` e configure manualmente em `config.js`:

```js
formFields: {
  dateFrom: '[name="txtDataDeposito_I"]',
  dateTo:   '[name="txtDataDeposito_F"]',
},
```

### 2. Modo lista rápida (recomendado para começar)

Salva os dados básicos da listagem (número, título, depositante, IPC, data, situação, URL do detalhe). Roda em horas.

```bash
node scraper.js list
```

### 3. Modo completo (lista + detalhe)

Visita cada página de detalhe. Muito mais lento (dias).

```bash
node scraper.js detail
```

### 4. Enriquecimento posterior

Depois de rodar o modo `list`, enriquece os registros com dados da página de detalhe:

```bash
node scraper.js enrich
```

### 5. Programas de Computador (scraper isolado)

Coleta dados da RPI (Secao VII - Programa de Computador) em um pipeline separado do scraper de patentes.

```bash
npm run scrape:programas
# ou
node scraper_programas.js
```

Regras aplicadas no scraper de programas:

- Usa arquivos dedicados (nao sobrescreve JSONL/checkpoints de patentes).
- Mantem rotacao automatica de JSONL por tamanho (`25MB` por padrao).
- Exclui indeferidos de forma conservadora:
  - so aceita despacho `730` (Expedicao do Certificado de Registro);
  - rejeita registros cujo texto de despacho contenha `indefer`.

---

## Retomada automática

O scraper salva o progresso em `data/progress.json` e os IDs já vistos em `data/seen_ids.json`.  
**Basta rodar o mesmo comando novamente** — ele retoma do ponto onde parou.

Para evitar arquivos gigantes, a saída JSONL é particionada automaticamente por tamanho (veja `maxJsonlPartSizeMB` em `config.js`).

---

## Arquivos gerados

| Arquivo | Descrição |
|---|---|
| `data/patentes.jsonl` | Base principal (primeira parte) |
| `data/patentes.part001.jsonl`, `data/patentes.part002.jsonl`, ... | Continuação automática da base quando atingir o limite de tamanho |
| `data/patentes_enriched.jsonl` + `data/patentes_enriched.partNNN.jsonl` | Versão enriquecida (modo enrich), também particionada |
| `data/progress.json` | Checkpoint de progresso |
| `data/seen_ids.json` | IDs já processados (deduplicação) |
| `data/errors.log` | Log de erros |

### Arquivos gerados (programas)

| Arquivo | Descrição |
|---|---|
| `data/programas.jsonl` | Base principal de programas de computador |
| `data/programas.part001.jsonl`, `data/programas.part002.jsonl`, ... | Continuação automática quando atingir o limite de tamanho |
| `data/progress_programas.json` | Checkpoint do scraper de programas |
| `data/seen_ids_programas.json` | IDs já processados (deduplicação) |
| `data/errors_programas.log` | Log de erros do scraper de programas |

---

## Estrutura de um registro (modo list)

```json
{
  "numero": "BR102021012345-1",
  "titulo": "SISTEMA DE MONITORAMENTO REMOTO",
  "depositante": "EMPRESA XYZ LTDA",
  "inventor": "SILVA, JOÃO",
  "ipc": "G06F 17/00",
  "data_deposito": "15/06/2021",
  "situacao": "Em exame",
  "url_detalhe": "https://busca.inpi.gov.br/pePI/...",
  "_scraped_at": "2026-05-11T10:30:00.000Z"
}
```

---

## Configurações (config.js)

| Parâmetro | Padrão | Descrição |
|---|---|---|
| `startDate` | `01/01/2000` | Data de início da varredura |
| `endDate` | hoje | Data de fim |
| `mode` | `list` | `list`, `detail` ou `enrich` |
| `maxJsonlPartSizeMB` | `25` | Tamanho máximo por arquivo JSONL antes de criar `*.partNNN.jsonl` |
| `resumeFromNextMonth` | `true` | Ao retomar, começa no mês seguinte ao `lastMonth` do progresso |
| `headless` | `true` | `false` para ver o browser |
| `pauseBetweenPages` | 2000ms | Intervalo entre páginas |
| `pauseBetweenMonths` | 3000ms | Intervalo entre meses |
| `fetchDetails` | — | Use `node scraper.js detail` |


---

## API REST



### Endpoints disponíveis

- `GET /api/health`
- `GET /api/search`
- `GET /api/patents/:numero`

### 1) Health check

```http
GET /api/health
```

Retorna status do serviço e informações da base carregada.

### 2) Busca paginada

```http
GET /api/search?q=energia&page=1&limit=20
```

Parâmetros suportados:

- `q`: termo livre (busca em número, título, depositante, inventor, IPC, data e situação)
- `numero`: filtro por número do processo
- `titulo`: filtro por título
- `depositante`: filtro por depositante
- `ipc`: filtro por IPC
- `page`: página (padrão `1`)
- `limit`: itens por página (padrão `20`, máximo `100`)

Exemplo:

```http
GET /api/search?depositante=PETROBRAS&ipc=G06&page=2&limit=50
```

Resposta:

```json
{
  "total": 1234,
  "page": 2,
  "limit": 50,
  "pages": 25,
  "items": [
    {
      "numero": "BR 10 2024 001998 9",
      "titulo": "SISTEMA E METODO ..."
    }
  ]
}
```

### 3) Buscar por número de processo

```http
GET /api/patents/PI%200009520-6
```

Retorna o registro completo da patente, ou `404` se não encontrar.

### Arquitetura da API

- A API sempre considera `data/patentes.jsonl` + `data/patentes.partNNN.jsonl` (quando existirem).
- Na primeira consulta, monta um índice único em memória com todos os registros.
- O endpoint de busca consulta esse índice (sem reler disco a cada request).
- Recarrega automaticamente o índice quando algum JSONL muda.

---

Opcional (caso queira apontar para outro arquivo de base):

- Variável de ambiente `INPI_DATA_FILE` com caminho do JSONL.


# Modo rápido (só lista) — horas para completar
node scraper.js list

# Modo completo (lista + detalhe de cada patente) — dias
node scraper.js detail

# Enriquecer depois (visita detalhes das já salvas)
node scraper.js enrich