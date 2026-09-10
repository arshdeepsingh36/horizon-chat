async function test() {
  const username = `test_u_${Date.now()}`;
  const password = "password123";
  const regRes = await fetch("https://horizon-chat-1.onrender.com/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const regData = await regRes.json();
  console.log("Registered:", regData.user?.username, "Token:", !!regData.token);
  const token = regData.token;
  if (!token) return;

  const uploadRes = await fetch("https://horizon-chat-1.onrender.com/api/media/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      imageBase64: "data:audio/mp4;base64,AAAAHGZ0eXBNNEEgAAAAAE00QSBtcDQyaXNvbQ==",
      fileName: "test_voice.m4a",
      fileSizeBytes: 28
    })
  });
  const uploadData = await uploadRes.json();
  console.log("Upload result:", JSON.stringify(uploadData, null, 2));

  if (uploadData.attachmentUrl) {
    console.log("Checking attachment URL:", uploadData.attachmentUrl);
    const fetchMedia = await fetch(uploadData.attachmentUrl);
    console.log("Fetch status:", fetchMedia.status, "Content-Type:", fetchMedia.headers.get("content-type"), "Length:", fetchMedia.headers.get("content-length"));
    const buffer = await fetchMedia.arrayBuffer();
    console.log("Buffer size downloaded:", buffer.byteLength);
    const firstBytes = Buffer.from(buffer.slice(0, 16)).toString('hex');
    console.log("First 16 bytes (hex):", firstBytes);
  }
}

test().catch(console.error);
