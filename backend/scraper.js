const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INDEX_URL = 'https://worldcraft.com.br/share/b240c700-408e-4849-a442-2e46e7dd6937';
const DB_PATH = path.join(__dirname, 'worldcraft-db.json');

// Fingerprint do artigo baseado no que aparece no índice (título, categoria, tags)
function indexHash(artigo) {
    return crypto.createHash('md5')
        .update(`${artigo.title}|${artigo.categoria}|${artigo.tags.sort().join(',')}`)
        .digest('hex');
}

function loadExistingDB() {
    if (!fs.existsSync(DB_PATH)) return new Map();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        return new Map(data.map(a => [a.id, a]));
    } catch {
        console.log('[DB] Arquivo existente não pôde ser lido — iniciando do zero.');
        return new Map();
    }
}

async function scrapeArtigoPage(page, artigo) {
    await page.goto(artigo.url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('dl, .ProseMirror', { timeout: 5000 }).catch(() => {
        console.log(`   [!] Aviso: ${artigo.title} sem conteúdo detectável.`);
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    const htmlArtigo = await page.content();
    const $art = cheerio.load(htmlArtigo);

    const infoSistema = [];
    $art('dl dt').each((_, element) => {
        const key = $art(element).text().trim();
        const value = $art(element).next('dd').text().trim();
        if (key && value) infoSistema.push(`${key.toUpperCase()}: ${value}`);
    });

    let textoLore = '';
    $art('.ProseMirror p').each((_, element) => {
        const paragrafo = $art(element).text().trim();
        if (paragrafo) textoLore += paragrafo + '\n\n';
    });

    let conteudoFinal = '';
    if (infoSistema.length > 0) {
        conteudoFinal += "===================================\n[ DADOS DO REGISTRO ]\n";
        infoSistema.forEach(info => conteudoFinal += `- ${info}\n`);
        conteudoFinal += "===================================\n\n";
    }
    conteudoFinal += textoLore.trim();

    return {
        id: artigo.id,
        title: artigo.title,
        summary: textoLore ? textoLore.substring(0, 100) + '...' : 'Sem descrição disponível no banco de dados.',
        content: conteudoFinal || 'Arquivo corrompido ou sem dados registrados.',
        categoria: artigo.categoria,
        tags: artigo.tags,
        source: 'worldcraft',
        _indexHash: indexHash(artigo)
    };
}

async function updateWorldcraftDatabase() {
    const forceUpdate = process.argv.includes('--force');

    console.log("Iniciando o sistema de interceptação (Puppeteer)...");
    if (forceUpdate) console.log("[MODO FORÇADO] Todos os artigos serão re-extraídos.");

    const existingDB = loadExistingDB();
    console.log(`[DB] ${existingDB.size} registros existentes carregados.`);

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
        console.log("Acessando banco de dados principal de Temperança...");
        await page.goto(INDEX_URL, { waitUntil: 'networkidle2' });

        console.log("Aguardando o servidor carregar o índice...");
        await page.waitForSelector('section a.group', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const htmlCompleto = await page.content();
        const $index = cheerio.load(htmlCompleto);

        const artigosNoIndice = [];

        $index('section').each((_, section) => {
            const categoria = $index(section).find('h2').text().trim();

            $index(section).find('a.group').each((_, card) => {
                let link = $index(card).attr('href');

                if (link && link.includes('/share/')) {
                    const absoluteUrl = link.startsWith('http') ? link : `https://worldcraft.com.br${link}`;
                    const title = $index(card).find('h3').text().trim();

                    const tags = [];
                    $index(card).find('.inline-flex.rounded-full').each((_, tagElement) => {
                        const tagText = $index(tagElement).text().trim();
                        if (tagText && isNaN(tagText)) tags.push(tagText);
                    });

                    const id = absoluteUrl.split('/').pop();
                    artigosNoIndice.push({ id, url: absoluteUrl, title, categoria, tags, source: 'worldcraft' });
                }
            });
        });

        console.log(`\n=> ÍNDICE: ${artigosNoIndice.length} registros encontrados.\n`);

        // Classifica cada artigo: novo, atualizado ou inalterado
        const paraVisitar = [];
        const mantidos = [];

        for (const artigo of artigosNoIndice) {
            const existente = existingDB.get(artigo.id);
            const hash = indexHash(artigo);

            if (!existente) {
                console.log(`[NOVO]        ${artigo.title}`);
                paraVisitar.push(artigo);
            } else if (forceUpdate || existente._indexHash !== hash) {
                console.log(`[ATUALIZADO]  ${artigo.title}`);
                paraVisitar.push(artigo);
            } else {
                mantidos.push(existente);
            }
        }

        if (paraVisitar.length === 0) {
            console.log('\n[INFO] Nenhum artigo novo ou atualizado encontrado. DB já está em dia!');
            return;
        }

        console.log(`\n=> ${paraVisitar.length} para raspar | ${mantidos.length} mantidos do cache.\n`);

        const scrapadosAgora = [];

        for (const artigo of paraVisitar) {
            console.log(`-> Extraindo: [${artigo.categoria}] ${artigo.title}`);
            const resultado = await scrapeArtigoPage(page, artigo);
            scrapadosAgora.push(resultado);
            console.log(`   [OK] Dados extraídos com sucesso.`);
        }

        // Monta o DB final mantendo a ordem do índice
        const indexIds = artigosNoIndice.map(a => a.id);
        const novaMap = new Map([
            ...mantidos.map(a => [a.id, a]),
            ...scrapadosAgora.map(a => [a.id, a])
        ]);
        const finalDB = indexIds.map(id => novaMap.get(id)).filter(Boolean);

        fs.writeFileSync(DB_PATH, JSON.stringify(finalDB, null, 2));

        console.log(`\n[SUCESSO] worldcraft-db.json atualizado!`);
        console.log(`  Novos/atualizados: ${scrapadosAgora.length} | Mantidos: ${mantidos.length} | Total: ${finalDB.length}`);

    } catch (error) {
        console.error("\n[ERRO CRÍTICO] Ocorreu uma falha no sistema:", error.message);
    } finally {
        await browser.close();
    }
}

updateWorldcraftDatabase();
