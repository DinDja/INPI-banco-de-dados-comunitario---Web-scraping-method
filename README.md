# INPI Patent Scraper

Robô que varre o portal [pePI do INPI](https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp) e constrói uma base de patentes local no formato **JSONL** (uma patente por linha).

---

## Pré-requisitos

```
Node.js >= 18
npm install       (já instalado)
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

---

## Retomada automática

O scraper salva o progresso em `data/progress.json` e os IDs já vistos em `data/seen_ids.json`.  
**Basta rodar o mesmo comando novamente** — ele retoma do ponto onde parou.

---

## Arquivos gerados

| Arquivo | Descrição |
|---|---|
| `data/patentes.jsonl` | Base principal (JSONL) |
| `data/patentes_enriched.jsonl` | Versão enriquecida (modo enrich) |
| `data/progress.json` | Checkpoint de progresso |
| `data/seen_ids.json` | IDs já processados (deduplicação) |
| `data/errors.log` | Log de erros |

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
| `headless` | `true` | `false` para ver o browser |
| `pauseBetweenPages` | 2000ms | Intervalo entre páginas |
| `pauseBetweenMonths` | 3000ms | Intervalo entre meses |
| `fetchDetails` | — | Use `node scraper.js detail` |


# Modo rápido (só lista) — horas para completar
node scraper.js list

# Modo completo (lista + detalhe de cada patente) — dias
node scraper.js detail

# Enriquecer depois (visita detalhes das já salvas)
node scraper.js enrich