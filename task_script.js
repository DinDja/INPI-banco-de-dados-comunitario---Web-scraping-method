const axios = require('axios');
const AdmZip = require('adm-zip');

async function run() {
    const url = 'https://revistas.inpi.gov.br/txt/PC2385.zip';
    console.log('Fetching ' + url);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const zip = new AdmZip(Buffer.from(response.data));
    const entries = zip.getEntries();
    
    console.log('Zip Entries:');
    entries.forEach(e => console.log('- ' + e.entryName));

    const txtEntry = entries.find(e => e.entryName.endsWith('.txt'));
    if (!txtEntry) {
        console.log('No .txt entry found.');
        return;
    }

    console.log('Processing: ' + txtEntry.entryName);
    const buffer = txtEntry.getData();
    
    let content = buffer.toString('utf8');
    if (content.includes('')) {
        content = buffer.toString('latin1');
    }

    const regex1 = /BR\s*51\s*2016\s*000567[-\s]*0/g;
    const regex2 = /000567/g;

    const matches1 = content.match(regex1) || [];
    const matches2 = content.match(regex2) || [];

    console.log('Match count (BR 51 2016 000567-0): ' + matches1.length);
    console.log('Match count (000567): ' + matches2.length);

    console.log('First 10 lines containing 000567:');
    const lines = content.split(/\r?\n/);
    let count = 0;
    for (const line of lines) {
        if (line.includes('000567')) {
            console.log(line);
            count++;
            if (count >= 10) break;
        }
    }
}

run().catch(err => console.error(err));
