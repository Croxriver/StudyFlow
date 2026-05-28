const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const outDir = path.join(rootDir, "dist-iis");
const webOutDir = path.join(outDir, "web");
const apiOutDir = path.join(outDir, "node-api");
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

const textExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".webmanifest",
  ".svg",
  ".xml",
  ".config"
]);

const skipNames = new Set([
  ".env",
  "node_modules",
  "dist-iis",
  ".git",
  "server.log",
  "server-error.log",
  "server-5191.log",
  "server-5191-error.log"
]);

const webEntries = [
  "assets",
  "index.html",
  "login.html",
  "signup.html",
  "student.html",
  "profile.html",
  "book.html",
  "child.html",
  "entry.html",
  "offline.html",
  "styles.css",
  "theme.js",
  "auth.js",
  "app.js",
  "student.js",
  "profile.js",
  "book.js",
  "child.js",
  "entry.js",
  "pwa-register.js",
  "push-client.js",
  "service-worker.js",
  "manifest.webmanifest",
  "web.config"
];

const apiEntries = [
  "server",
  "db",
  "scripts",
  "package.json",
  "package-lock.json",
  ".env.example"
];

function shouldSkip(name) {
  return skipNames.has(name) || name.endsWith(".log") || name.endsWith(".zip");
}

function copyEntry(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      if (!shouldSkip(name)) copyEntry(path.join(source, name), path.join(target, name));
    }
    return;
  }

  const extension = path.extname(source).toLowerCase();
  if (!textExtensions.has(extension)) {
    fs.copyFileSync(source, target);
    return;
  }

  const content = fs.readFileSync(source);
  const hasBom = content.length >= 3 &&
    content[0] === 0xef &&
    content[1] === 0xbb &&
    content[2] === 0xbf;
  fs.writeFileSync(target, hasBom ? content : Buffer.concat([utf8Bom, content]));
}

function copyNamedEntries(entries, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of entries) {
    const source = path.join(rootDir, name);
    if (!fs.existsSync(source) || shouldSkip(name)) continue;
    copyEntry(source, path.join(targetDir, name));
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

copyNamedEntries(webEntries, webOutDir);
copyNamedEntries(apiEntries, apiOutDir);

fs.writeFileSync(
  path.join(outDir, "README.txt"),
  Buffer.concat([
    utf8Bom,
    Buffer.from(
      [
        "StudyFlow IIS deployment bundle",
        "",
        "1. web 폴더",
        "   - FTP로 IIS의 /studyflow/ 폴더에 업로드합니다.",
        "   - HTML, CSS, JS, PWA 파일, 이미지, web.config가 들어 있습니다.",
        "",
        "2. node-api 폴더",
        "   - Node를 실행할 서버 폴더에 업로드합니다.",
        "   - 서버에서 .env를 만들고 npm ci 후 npm start를 실행합니다.",
        "   - IIS의 /api/* 요청을 이 Node 서버로 프록시해야 합니다.",
        "",
        "주의: node_modules는 FTP로 올리지 말고 서버에서 npm ci로 설치하세요.",
        ""
      ].join("\r\n"),
      "utf8"
    )
  ])
);

console.log(`Created IIS web bundle: ${webOutDir}`);
console.log(`Created Node API bundle: ${apiOutDir}`);
