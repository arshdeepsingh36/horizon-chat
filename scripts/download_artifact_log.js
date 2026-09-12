const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = 'arshdeepsingh36/horizon-chat';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node.js' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function monitor() {
  const headSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  console.log('Monitoring for commit:', headSha.substring(0, 7));

  while (true) {
    try {
      const runs = await fetchJson(`https://api.github.com/repos/${REPO}/actions/runs?per_page=3`);
      const run = runs.workflow_runs.find(r => r.head_sha === headSha);
      if (run) {
        console.log(`[${new Date().toLocaleTimeString()}] Run #${run.id} Status: ${run.status}, Conclusion: ${run.conclusion || 'pending'}`);
        if (run.status === 'completed') {
          console.log('Checking artifacts...');
          const arts = await fetchJson(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/artifacts`);
          console.log('Artifacts:', arts.artifacts.map(a => ({ id: a.id, name: a.name, size: a.size_in_bytes })));
          break;
        }
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
    await new Promise(r => setTimeout(r, 6000));
  }
}

monitor();
