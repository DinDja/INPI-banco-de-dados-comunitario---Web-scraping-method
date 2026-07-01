# 🏛️ INPI Patent Scraper

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-success)](https://github.com/INPI-banco-de-dados-comunitario---Web-scraping-method)

> 🤖 Robô que varre o portal [pePI do INPI](https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp) e constrói uma base de patentes local no formato **JSONL** (uma patente por linha).

```
   ____  ___  ______  __  __  ____  _____ 
  (  _ \/ _ \(  __  )(  \/  )(  _ \(  __)
   )   ( (_) )(_  )(  )    (  )___/ )  (  
  (__/\_\___/(____)(__)\/\__)(__)  (____)
                                          
  ____  ____  ______  ____  _____ 
 (  _ \(  _ \(  __  )(  _ \(  __)
  ) __/ )   / )(_  )(  __/ )  (  
 (__)  (__\_)(____)(__)  (____)
```

---

## 📋 Índice

- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Uso](#-uso)
- [Configurações](#-configurações)
- [API REST](#-api-rest)
- [Arquivos Gerados](#-arquivos-gerados)
- [Estrutura de Dados](#-estrutura-de-dados)

---

## ⚙️ Pré-requisitos

```bash
Node.js >= 18
```

---

## 🚀 Instalação

```bash
# Clone o repositório
git clone https://github.com/INPI-banco-de-dados-comunitario---Web-scraping-method.git

# Instale as dependências
npm install
```

---

## 🎯 Uso

### 1. 🔍 Diagnóstico (primeira vez)

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

### 2. 📋 Modo lista rápida (recomendado para começar)

Salva os dados básicos da listagem (número, título, depositante, IPC, data, situação, URL do detalhe). Roda em horas.

```bash
node scraper.js list
```

### 3. 📄 Modo completo (lista + detalhe)

Visita cada página de detalhe. Muito mais lento (dias).

```bash
node scraper.js detail
```

### 4. ✨ Enriquecimento posterior

Depois de rodar o modo `list`, enriquece os registros com dados da página de detalhe:

```bash
node scraper.js enrich
```

### 5. 📰 Patentes via RPI (recomendado para garantir depositante)

Coleta patentes pela **Revista da Propriedade Industrial (Secao VI)**, sem depender do BuscaWeb.

```bash
npm run scrape:patentes:rpi
# ou
node scraper_patentes_rpi.js
```

Para refazer a base de patentes do zero (limpa `patentes*.jsonl` + checkpoints do scraper RPI):

```powershell
$env:INPI_PATENTES_RPI_FRESH_START='true'
npm run scrape:patentes:rpi
```

**Variáveis úteis:**

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `INPI_PATENTES_START_RPI` | `2404` | RPI inicial |
| `INPI_PATENTES_END_RPI` | auto | RPI final (detecta automaticamente) |
| `INPI_PATENTES_REQUIRE_DEPOSITANTE` | `true` | Exige depositante |
| `INPI_PATENTES_DEDUPE_BY_NUMERO` | `true` | Remove duplicados |

#### Preencher campos nulos/vazios

Se você já tem `patentes*.jsonl` e quer **apenas preencher campos faltantes**:

```bash
npm run patentes:fill:nulls:rpi
```

Este comando:
- ✅ Reaproveita os registros atuais
- ✅ Preenche somente campos faltantes (`depositante`, `titular`, `inventor`, `ipc`, `titulo`, `data_deposito`)
- ✅ Regrava apenas os arquivos alterados
- ✅ Cria backup automático (`*.bak-null-enrich-*`) por padrão

Exemplo com faixa de RPI:

```powershell
$env:INPI_PATENTES_START_RPI='2800'
$env:INPI_PATENTES_END_RPI='2888'
npm run patentes:fill:nulls:rpi
```

Para reiniciar o checkpoint:

```powershell
$env:INPI_PATENTES_NULL_ENRICH_RESET_PROGRESS='true'
npm run patentes:fill:nulls:rpi
```

#### Sync completo (buscar novos + preencher nulos)

```bash
npm run patentes:sync:rpi
```

### 6. 💻 Programas de Computador (scraper isolado)

Coleta dados da RPI (Secao VII - Programa de Computador) em um pipeline separado.

```bash
npm run scrape:programas
# ou
node scraper_programas.js
```

**Regras aplicadas:**
- 📁 Usa arquivos dedicados (não sobrescreve JSONL/checkpoints de patentes)
- 🔄 Mantém rotação automática de JSONL por tamanho (`25MB` por padrão)
- ❌ Exclui indeferidos de forma conservadora:
  - Só aceita despacho `730` (Expedição do Certificado de Registro)
  - Rejeita registros cujo texto contenha `indefer`

### 7. ™️ Marcas (scraper isolado)

Coleta dados da RPI (Secao V - Marcas) em um pipeline separado.

```bash
npm run scrape:marcas
# ou
node scraper_marcas.js
```

**Regras aplicadas:**
- 📁 Usa arquivos dedicados (não sobrescreve JSONL/checkpoints de patentes/programas)
- 🔄 Mantém rotação automática de JSONL por tamanho (`25MB` por padrão)
- 📄 Lê o XML de marcas dentro do arquivo `RM{RPI}.zip` publicado no portal da RPI
- ✅ Por padrão, salva apenas registros com nome de marca preenchido
- 🔍 Permite filtro opcional por código de despacho via `INPI_MARCAS_DISPATCH_CODES`

---

## 🔄 Retomada Automática

O scraper salva o progresso em `data/progress.json` e os IDs já vistos em `data/seen_ids.json`.

**Basta rodar o mesmo comando novamente** — ele retoma do ponto onde parou.

Para evitar arquivos gigantes, a saída JSONL é particionada automaticamente por tamanho (veja `maxJsonlPartSizeMB` em `config.js`).

---

## ⚙️ Configurações (config.js)

| Parâmetro | Padrão | Descrição |
|-----------|--------|-----------|
| `startDate` | `01/01/2000` | Data de início da varredura |
| `endDate` | hoje | Data de fim |
| `mode` | `list` | `list`, `detail` ou `enrich` |
| `maxJsonlPartSizeMB` | `25` | Tamanho máximo por arquivo JSONL |
| `resumeFromNextMonth` | `true` | Ao retomar, começa no mês seguinte |
| `headless` | `true` | `false` para ver o browser |
| `pauseBetweenPages` | `2000ms` | Intervalo entre páginas |
| `pauseBetweenMonths` | `3000ms` | Intervalo entre meses |
| `fetchDetails` | — | Use `node scraper.js detail` |

---

## 🌐 API REST

### Endpoints disponíveis

```
GET /api/health           # Health check
GET /api/search           # Busca paginada
GET /api/patents/:numero  # Buscar patente por número
GET /api/marcas/:numero   # Buscar marca por número
```

### 1. Health Check

```http
GET /api/health
```

Retorna status do serviço e informações da base carregada.

### 2. 🔍 Busca Paginada

```http
GET /api/search?q=energia&page=1&limit=20
```

O endpoint busca em **patentes**, **programas** e **marcas**. Use `tipo` para restringir.

**Parâmetros suportados:**

| Parâmetro | Descrição |
|-----------|-----------|
| `q` | Termo livre (busca em campos textuais principais) |
| `tipo` | `patente`, `programa` ou `marca` |
| `numero` | Filtro por número do processo |
| `titulo` | Filtro por título |
| `marca` | Filtro pelo nome da marca |
| `apresentacao` | Filtro pela apresentação da marca |
| `natureza` | Filtro pela natureza da marca |
| `depositante` | Filtro por depositante |
| `ipc` | Filtro por IPC |
| `classe_nice` | Filtro por classe NICE |
| `classe_nice_status` | Filtro por status da classe NICE |
| `classe_vienna` | Filtro por classe de Viena |
| `despacho_codigo` | Filtro por código do despacho |
| `despacho_nome` | Filtro por nome do despacho |
| `procurador` | Filtro por procurador |
| `prioridade_unionista` | Filtro por prioridade unionista |
| `rpi_numero` | Filtro por número da RPI |
| `rpi_data_publicacao` | Filtro por data de publicação da RPI |
| `page` | Página (padrão `1`) |
| `limit` | Itens por página (padrão `20`, máximo `100`) |

**Exemplos:**

```http
GET /api/search?depositante=PETROBRAS&ipc=G06&page=2&limit=50
GET /api/search?tipo=marca&marca=thermocook&classe_nice=21&page=1&limit=20
```

**Resposta:**

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

### 3. 📄 Buscar por número de processo (patentes)

```http
GET /api/patents/PI%200009520-6
```

Retorna o registro completo da patente, ou `404` se não encontrar.

### 4. ™️ Buscar marca por número de processo

```http
GET /api/marcas/943451302
```

Retorna o registro completo da marca, ou `404` se não encontrar.

### 🏗️ Arquitetura da API

- 📂 A API considera `data/patentes*.jsonl`, `data/programas*.jsonl` e `data/marcas*.jsonl` (quando existirem)
- 🧠 Na primeira consulta, monta um índice único em memória com todos os registros
- 🔍 O endpoint de busca consulta esse índice (sem reler disco a cada request)
- 🔄 Recarrega automaticamente o índice quando algum JSONL muda

---

## 📁 Arquivos Gerados

### Patentes

| Arquivo | Descrição |
|---------|-----------|
| `data/patentes.jsonl` | Base principal (primeira parte) |
| `data/patentes.part001.jsonl`, `data/patentes.part002.jsonl`, ... | Continuação automática quando atingir o limite |
| `data/patentes_enriched.jsonl` + `data/patentes_enriched.partNNN.jsonl` | Versão enriquecida (modo enrich) |
| `data/progress.json` | Checkpoint de progresso |
| `data/seen_ids.json` | IDs já processados (deduplicação) |
| `data/errors.log` | Log de erros |
| `data/progress_patentes_rpi.json` | Checkpoint do scraper RPI |
| `data/seen_ids_patentes_rpi.json` | IDs já processados no scraper RPI |
| `data/errors_patentes_rpi.log` | Log de erros do scraper RPI |

### Programas de Computador

| Arquivo | Descrição |
|---------|-----------|
| `data/programas.jsonl` | Base principal de programas |
| `data/programas.part001.jsonl`, `data/programas.part002.jsonl`, ... | Continuação automática |
| `data/progress_programas.json` | Checkpoint do scraper de programas |
| `data/seen_ids_programas.json` | IDs já processados (deduplicação) |
| `data/errors_programas.log` | Log de erros do scraper de programas |

### Marcas

| Arquivo | Descrição |
|---------|-----------|
| `data/marcas.jsonl` | Base principal de marcas |
| `data/marcas.part001.jsonl`, `data/marcas.part002.jsonl`, ... | Continuação automática |
| `data/progress_marcas.json` | Checkpoint do scraper de marcas |
| `data/seen_ids_marcas.json` | IDs já processados (deduplicação) |
| `data/errors_marcas.log` | Log de erros do scraper de marcas |

---

## 📊 Estrutura de um Registro (modo list)

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

## ⚡ Comandos Rápidos

```bash
# Modo rápido (só lista) — horas para completar
node scraper.js list

# Modo completo (lista + detalhe de cada patente) — dias
node scraper.js detail

# Enriquecer depois (visita detalhes das já salvas)
node scraper.js enrich
```

---

## 📝 Licença

MIT © [INPI Banco de Dados Comunitário](https://github.com/INPI-banco-de-dados-comunitario---Web-scraping-method)