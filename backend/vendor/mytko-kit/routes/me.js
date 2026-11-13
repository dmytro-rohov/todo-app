// The signed-in account's own settings: the interface language (Ukrainian by default, or Polish), kept on the account so
// every device opens in it. present: the account as the app shows it (default: id, login, name, role, lang). The
// router is returned for the app to add its own routes to (e.g. Finance's /api/me/payout).
// Express is the app's own dependency, loaded when a router is made (the kit itself loads with Node alone: an app's
// configuration check runs without node_modules).
const loadExpress = () => require("express");
const { LANGUAGES } = require("../users");
const { publicUser } = require("./auth");

function createMeRouter({ users, present = publicUser }) {
  const router = loadExpress().Router();

  router.get("/", (req, res) => {
    res.json(present(req.user));
  });

  router.patch("/", async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "lang") || !("lang" in body)) {
      return res.status(400).json({ message: "Unknown or empty fields" });
    }
    if (!LANGUAGES.includes(body.lang)) return res.status(400).json({ message: "Unsupported language" });
    const user = await users.setLang(req.user.id, body.lang);
    if (!user) return res.status(404).json({ message: "Account not found" });
    res.json(present(user));
  });

  return router;
}

module.exports = { createMeRouter };
