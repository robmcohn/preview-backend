const url = require('url');
const http = require('http');
const mime = require('mime');

const {getObject, putObject} = require('../aws.js');
const browserManager = require('../browser-manager.js');

const bucketNames = {
  preview: 'preview-exokit-org',
};
const storageHost = 'https://ipfs.exokit.org';

const _makePromise = () => {
  let accept, reject;
  const p = new Promise((a, r) => {
    accept = a;
    reject = r;
  });
  p.accept = accept;
  p.reject = reject;
  return p;
};

const _warn = err => {
  console.warn('uncaught: ' + err.stack);
};
process.on('uncaughtException', _warn);
process.on('unhandledRejection', _warn);

let browser;
(async () => {
browser = await browserManager.getBrowser();
ticketManager = browserManager.makeTicketManager(4);
})();

const _handleCardPreviewRequest = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');

  const u = url.parse(req.url, true);
  const match = u.pathname.match(/^\/([0-9]+)$/);
  const tokenId = parseInt(match?.[1] || '', 10);
  const {query = {}} = u;
  const {w = 500 + '', ext = 'png'} = query;
  const cardWidth = parseInt(w, 10);
  if (!isNaN(tokenId) && ['png', 'jpg'].includes(ext) && !isNaN(cardWidth)) {
    const cardHeight = cardWidth / 2.5 * 3.5;
    const cache = !query['nocache'];
    const key = `cards/${tokenId}/${ext}`;
    const o = cache ? await (async () => {
      try {
        return await getObject(
          bucketNames.preview,
          key,
        );
      } catch(err) {
        // console.warn(err);
        return null;
      }
    })() : null;
    const contentType = mime.getType(ext);
    if (o) {
      // res.setHeader('Content-Type', o.ContentType || 'application/octet-stream');
      res.setHeader('Content-Type', contentType);
      res.end(o.Body);
    } else {
      await ticketManager.lock();

      let page;
      try {
        // console.log('preview 3');
        page = await browser.newPage();
        // console.log('preview 4');
        page.on('console', e => {
          console.log(e);
        });
        page.on('error', err => {
          console.log(err);
        });
        page.on('pageerror', err => {
          console.log(err);
        });

        let timeout;
        const t = new Promise((accept, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('timed out'));
          }, 10 * 1000);
        });

        await Promise.race([
          (async () => {
            // console.log('load page 1');
            await page.setViewport({
              width: cardWidth,
              height: cardHeight,
            });
            const p = _makePromise();
            await page.exposeFunction('onMessageReceivedEvent', e => {
              p.accept(e.data);
            });
            // console.log('load page 2');
            await page.goto(`https://cards.webaverse.com/?t=${tokenId}&w=${cardWidth}`);
            // console.log('load page 3');
            
            function listenFor(type) {
              return page.evaluateOnNewDocument(type => {
                window.addEventListener(type, e => {
                  window.onMessageReceivedEvent({type, data: e.data});
                });
              }, type);
            }
            await listenFor('message'); // Listen for "message" custom event on page load.
            
            // console.log('load page 4');
            
            await p;
            
            // console.log('load page 5');
            
            const b = await page.screenshot({
              type: (() => {
                switch (ext) {
                  case 'png': return 'png';
                  case 'jpg': return 'jpeg';
                  default: return null;
                }
              })(),
            });
            // console.log('load page 6');
            
            res.setHeader('Content-Type', contentType);
            res.end(b);

            if (cache) {
              await putObject(
                bucketNames.preview,
                key,
                b,
                contentType,
              );
            }
          })(),
          t,
        ]);
      } catch (err) {
        console.warn(err.stack);
      } finally {
        ticketManager.unlock();

        if (page) {
          page.close();
        }
      }
    }
  } else {
    res.statusCode = 404;
    res.end();
  }
};

module.exports = {
  _handleCardPreviewRequest,
}