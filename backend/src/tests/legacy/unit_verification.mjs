async function runUnitAndMultiUnitVerification() {
  const runId = Date.now().toString().slice(-5);

  // 1. Register business
  const bRes = await fetch('http://localhost:5000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: `Unit Proof Biz ${runId}`,
      businessSlug: `unit-proof-${runId}`,
      ownerName: 'Chef Vendor',
      email: `vendor_${runId}@unitproof.com`,
      password: 'password123',
      categoryTemplate: 'custom',
      phone: `9922${runId}`
    })
  });
  const bData = await bRes.json();
  const bizId = bData.business.id;
  const token = bData.token;

  // Case A Catalog Item: Banana (unit: dozen)
  await fetch('http://localhost:5000/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Banana', unit: 'dozen', currentPrice: 60 })
  });

  // Case B Catalog Items: Watermelon sold in BOTH 'piece' and 'kg'
  const r1 = await fetch('http://localhost:5000/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Watermelon (by piece)', unit: 'piece', currentPrice: 80 })
  });
  const r2 = await fetch('http://localhost:5000/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Watermelon (by kg)', unit: 'kg', currentPrice: 25 })
  });
  console.log('Product 1 created:', r1.status);
  console.log('Product 2 created:', r2.status);

  // Customer A (for Banana 4)
  const phoneA = `9333${runId}`;
  await fetch('http://localhost:5000/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Restaurant A', phone: phoneA })
  });

  // Customer B (for Watermelon 5 with no unit)
  const phoneB = `9444${runId}`;
  await fetch('http://localhost:5000/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Restaurant B', phone: phoneB })
  });

  // Send Webhook A: 'Banana 4'
  await fetch(`http://localhost:5000/webhooks/whatsapp/${bizId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerMessageId: `msg_banana_${runId}`,
      senderPhone: phoneA,
      messageText: 'Banana 4'
    })
  });

  // Send Webhook B: 'Watermelon 5' (No unit, but vendor sells both piece and kg)
  await fetch(`http://localhost:5000/webhooks/whatsapp/${bizId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerMessageId: `msg_melon_${runId}`,
      senderPhone: phoneB,
      messageText: 'Watermelon 5'
    })
  });

  await new Promise(r => setTimeout(r, 2000));

  const msgRes = await fetch('http://localhost:5000/api/whatsapp/messages');
  const msgs = await msgRes.json();

  const sentToA = msgs.messages.reverse().find(m => m.to === phoneA);
  const sentToB = msgs.messages.find(m => m.to === phoneB);

  console.log('================================================================');
  console.log('CASE 1: "Banana 4" (No Unit Specified -> Inherit Catalog "dozen")');
  console.log('================================================================');
  console.log(sentToA?.text || 'No message sent');

  console.log('\n================================================================');
  console.log('CASE 2: "Watermelon 5" (No Unit Specified -> Multi-Unit Ambiguity Clarification)');
  console.log('================================================================');
  console.log(sentToB?.text || 'No message sent');
  console.log('================================================================');

  process.exit(0);
}

runUnitAndMultiUnitVerification().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
