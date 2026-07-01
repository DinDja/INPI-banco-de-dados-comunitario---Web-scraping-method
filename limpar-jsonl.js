const fs = require("fs");
const path = require("path");

const pasta = path.join(__dirname, "data");

const arquivos = fs
  .readdirSync(pasta)
  .filter((a) => a.endsWith(".jsonl"));

console.log("Arquivos encontrados:");
console.log(arquivos);

for (const arquivo of arquivos) {
  console.log(`\nProcessando ${arquivo}...`);

  const caminho = path.join(pasta, arquivo);

  const conteudo = fs.readFileSync(caminho, "utf8");

  const linhas = conteudo
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== "");

  const resultado = [];

  for (const linha of linhas) {
    try {
      const obj = JSON.parse(linha);

      if (
        obj.titulo === null ||
        obj.titulo === undefined ||
        String(obj.titulo).trim() === ""
      ) {
        continue;
      }

      delete obj.situacao;
      delete obj.url_detalhe;
      delete obj._scraped_at;

      resultado.push(JSON.stringify(obj));

    } catch (e) {
      console.log("Erro JSON:", e.message);
    }
  }

  fs.writeFileSync(caminho, resultado.join("\n"), "utf8");

  console.log(`Finalizado: ${arquivo}`);
}

console.log("\nConcluído.");