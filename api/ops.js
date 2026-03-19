export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || (req.body && req.body.action);

  // GET: health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      actions: ['close_issues', 'create_coupon'],
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  const results = {};

  // Action: close and scrub GitHub issues
  if (action === 'close_issues' || action === 'all') {
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) {
      results.issues = { error: 'No GITHUB_TOKEN' };
    } else {
      const issueNums = req.body.issues || [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const closed = [];
      const errors = [];
      for (const num of issueNums) {
        try {
          const r = await fetch(`https://api.github.com/repos/getmilodev/milo-website/issues/${num}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${ghToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ state: 'closed', body: '_Content removed — moved to internal docs._' })
          });
          if (r.ok) { closed.push(num); } else { errors.push({ num, status: r.status }); }
        } catch (e) { errors.push({ num, error: e.message }); }
      }
      results.issues = { closed, errors };
    }
  }

  // Action: create Stripe coupon + promo code
  if (action === 'create_coupon' || action === 'all') {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      results.coupon = { error: 'No STRIPE_SECRET_KEY' };
    } else {
      try {
        // Create coupon
        const couponRes = await fetch('https://api.stripe.com/v1/coupons', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(stripeKey + ':').toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'percent_off=25&duration=once&id=EARLYMILO25&name=Early Milo 25% Off'
        });
        const couponData = await couponRes.json();

        if (couponRes.ok) {
          // Create promotion code
          const promoRes = await fetch('https://api.stripe.com/v1/promotion_codes', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${Buffer.from(stripeKey + ':').toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'coupon=EARLYMILO25&code=EARLYMILO25&active=true'
          });
          const promoData = await promoRes.json();
          results.coupon = { coupon: couponData.id, promo: promoData.code || promoData, ok: true };
        } else {
          results.coupon = { error: couponData.error };
        }
      } catch (e) {
        results.coupon = { error: e.message };
      }
    }
  }

  return res.status(200).json(results);
}
