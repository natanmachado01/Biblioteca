const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const INDEX_URL = 'https://worldcraft.com.br/share/b240c700-408e-4849-a442-2e46e7dd6937';

async function updateWorldcraftDatabase() {
    console.log("Iniciando o sistema de interceptação (Puppeteer)...");
    
    // Mantendo o modo visual ativado para acompanharmos
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
        
        const artigosParaVisitar = [];
        const databaseCompleta = [];

        $index('section').each((i, section) => {
            const categoria = $index(section).find('h2').text().trim();

            $index(section).find('a.group').each((j, card) => {
                let link = $index(card).attr('href');
                
                if (link && link.includes('/share/')) {
                    const absoluteUrl = link.startsWith('http') ? link : `https://worldcraft.com.br${link}`;
                    const title = $index(card).find('h3').text().trim();
                    
                    const tags = [];
                    $index(card).find('.inline-flex.rounded-full').each((k, tagElement) => {
                        const tagText = $index(tagElement).text().trim();
                        if (tagText && isNaN(tagText)) tags.push(tagText);
                    });

                    const id = absoluteUrl.split('/').pop();

                    artigosParaVisitar.push({
                        id,
                        url: absoluteUrl,
                        title,
                        categoria,
                        tags,
                        source: 'worldcraft'
                    });
                }
            });
        });

        console.log(`\n=> SUCESSO NO ÍNDICE: Encontrados ${artigosParaVisitar.length} registros.\n`);

        for (const artigo of artigosParaVisitar) {
            console.log(`-> Hackeando dados de: [${artigo.categoria}] ${artigo.title}`);
            
            await page.goto(artigo.url, { waitUntil: 'networkidle2' });
            
            // Pede pro robô esperar a caixa de informações (dl) OU o texto do editor (.ProseMirror) aparecer.
            // O .catch no final evita que o script quebre se a página estiver realmente vazia.
            await page.waitForSelector('dl, .ProseMirror', { timeout: 5000 }).catch(() => {
                console.log(`   [!] Aviso: ${artigo.title} parece não ter texto ou demorou muito.`);
            });

            // Dá 1 segundinho pro layout se estabilizar
            await new Promise(resolve => setTimeout(resolve, 1000));

            const htmlArtigo = await page.content();
            const $art = cheerio.load(htmlArtigo);
            
            const infoSistema = [];
            $art('dl dt').each((index, element) => {
                const key = $art(element).text().trim();
                const value = $art(element).next('dd').text().trim(); 
                if (key && value) {
                    infoSistema.push(`${key.toUpperCase()}: ${value}`);
                }
            });

            let textoLore = '';
            $art('.ProseMirror p').each((index, element) => {
                const paragrafo = $art(element).text().trim();
                if (paragrafo) { 
                    textoLore += paragrafo + '\n\n';
                }
            });

            let conteudoFinal = '';
            if (infoSistema.length > 0) {
                conteudoFinal += "===================================\n";
                conteudoFinal += "[ DADOS DO REGISTRO ]\n";
                infoSistema.forEach(info => conteudoFinal += `- ${info}\n`);
                conteudoFinal += "===================================\n\n";
            }
            conteudoFinal += textoLore.trim();

            // REMOVEMOS A REGRA RÍGIDA! Agora ele salva o personagem de qualquer jeito.
            databaseCompleta.push({
                id: artigo.id,
                title: artigo.title,
                summary: textoLore ? textoLore.substring(0, 100) + '...' : 'Sem descrição disponível no banco de dados.',
                content: conteudoFinal || 'Arquivo corrompido ou sem dados registrados.',
                categoria: artigo.categoria,
                tags: artigo.tags,
                source: 'worldcraft'
            });
            
            console.log(`   [OK] Dados extraídos com sucesso.`);
        }

        // Salva tudo no JSON!
        fs.writeFileSync(path.join(__dirname, 'worldcraft-db.json'), JSON.stringify(databaseCompleta, null, 2));
        console.log("\n[SUCESSO] O arquivo worldcraft-db.json foi populado!");

    } catch (error) {
        console.error("\n[ERRO CRÍTICO] Ocorreu uma falha no sistema:", error.message);
    } finally {
        await browser.close();
    }
}

updateWorldcraftDatabase();