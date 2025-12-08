const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");

async function checkUserExists(nationalNo, targetUrl) {
  const url = targetUrl || "http://localhost:5173/ForgetPassword.aspx";

  try {
    const pageRes = await fetch(url, { method: "GET" });
    const pageHtml = await pageRes.text();

    const dom = new JSDOM(pageHtml);
    const doc = dom.window.document;

    const formData = new URLSearchParams();
    doc.querySelectorAll('input[type="hidden"]').forEach((input) => {
      if (input.name) formData.append(input.name, input.value || "");
    });

    formData.append("Radio1", "rbPersonal");
    formData.append("txtNationalNo", nationalNo);
    formData.append("ddlYears", "51");
    formData.append("btnGetMobileNumber", "ارسال");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
    });

    const resHtml = await response.text();

    const exists =
      resHtml.includes("کد تایید") ||
      resHtml.includes("پیامک") ||
      resHtml.includes("موبایل") ||
      resHtml.includes("txtVerifyCode") ||
      resHtml.includes("pnlVerifyCode");

    return { exists, nationalNo };
  } catch (err) {
    return { exists: null, error: err.message, nationalNo };
  }
}

module.exports = { checkUserExists };
