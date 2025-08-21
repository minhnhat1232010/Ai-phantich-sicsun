const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 10000;

// API gốc
const SOURCE_API = "https://sicbopredict.onrender.com/api/sunwin/predict";

app.get("/", async (req, res) => {
  try {
    // Gọi API gốc
    const response = await fetch(SOURCE_API, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });

    const data = await response.json();

    if (!data || !data.du_doan_cho_phien) {
      return res.json({ error: "Không lấy được dữ liệu gốc" });
    }

    // Mapping dữ liệu sang format chuẩn
    const result = {
      phien_truoc: `#${data.phien_hien_tai || ""}`,
      xuc_xac: data.xuc_xac || [0, 0, 0],
      tong: data.tong || 0,
      md5: data.md5 || "",
      phien_sau: `#${data.du_doan_cho_phien || ""}`,
      du_doan: (data.du_doan_chinh && data.du_doan_chinh.prediction) || "X",
      doan_vi: (data.du_doan_chinh && data.du_doan_chinh.scores) || [0, 0, 0],
      do_tin_cay: (data.du_doan_chinh && data.du_doan_chinh.tin_cay) || "80%"
    };

    res.json(result);

  } catch (err) {
    console.error("Lỗi:", err);
    res.json({ error: "Không lấy được dữ liệu" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://0.0.0.0:${PORT}`);
});
