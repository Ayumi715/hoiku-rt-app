// 使い方: npm run set-expert -- expert@example.com
// 事前に Firebase コンソール → プロジェクトの設定 → サービスアカウント →
// 「新しい秘密鍵を生成」で得たJSONを scripts/serviceAccountKey.json として置く
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });

const email = process.argv[2];
if (!email) { console.error("メールアドレスを指定してください"); process.exit(1); }

admin.auth().getUserByEmail(email)
  .then(u => admin.auth().setCustomUserClaims(u.uid, { role: "expert" }))
  .then(() => { console.log("付与しました。再ログインで反映されます:", email); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });