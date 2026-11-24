const tick = String.fromCharCode(96);
const stripTicks = x => x.trim().split(tick).join('');
function section(doc,title) {
  const lines=doc.split('\n'), at=lines.findIndex(l=>l.trim()===title);
  if(at<0)return [];
  const level=title.match(/^#+/)[0].length;
  const end=lines.findIndex((l,i)=>i>at && /^#{1,6} /.test(l) && l.match(/^#+/)[0].length<=level);
  return lines.slice(at+1,end<0?undefined:end);
}
function table(lines) {
  return lines.filter(l=>l.trim().startsWith('|')).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim()));
}
export function parseModelCard(doc,model) {
  const published=doc.match(/^Model ID:\s*(.+)$/m);
  if(!published || stripTicks(published[1])!==model)throw new Error('model_card_identity_mismatch');
  const details=section(doc,'## Model details'), features=section(doc,'## Supported features');
  function number(label) {
    const v=details.find(l=>l.trim().endsWith(' '+label))?.match(/^- ([0-9][0-9,]*) /);
    return v ? Number(v[1].replaceAll(',','')) : null;
  }
  function modalities(label) {
    const line=details.find(l=>l.startsWith('- '+label+': '));
    return line ? line.slice(label.length+4).split(',').map(x=>x.trim()) : null;
  }
  const rateRows=table(section(section(doc,'## Pricing').join('\n'),'### Text tokens'));
  const prices={};
  if(rateRows[0]?.join('|')==='Metric|Price|Unit') for(const [metric,amount,unit] of rateRows.slice(2)) {
    if(['Input','Cached input','Output'].includes(metric) && unit==='1M tokens' && /^\$\d{1,6}(?:\.\d{1,6})?$/.test(amount)) prices[metric]=amount.slice(1);
  }
  const rateLimits=table(section(section(doc,'## Rate limits').join('\n'),'### default'));
  const aliases=section(doc,'## Snapshots').filter(l=>l.startsWith('- ')).map(l=>stripTicks(l.slice(2))).slice(0,32);
  const data={ model, status:doc.match(/^Status:\s*(.+)$/m)?.[1].trim()||null, context_tokens:number('context window'),max_output_tokens:number('max output tokens'),
    input_modalities:modalities('Input modalities'),output_modalities:modalities('Output modalities'),features:features.length?features.filter(l=>l.startsWith('- ')).map(l=>l.slice(2).trim()):null,
    text_price_usd_per_million:prices,snapshots:aliases,default_tier_limits:rateLimits.length>2 ? {fields:rateLimits[0],rows:rateLimits.slice(2,16)}:null };
  if(!data.context_tokens && !Object.keys(prices).length && !data.features?.length)throw new Error('model_card_layout_unrecognized');
  return data;
}
export function tokenCost(prices,inputTokens,outputTokens) {
  function units(s) {
    if(!/^\d+(?:\.\d{1,6})?$/.test(s || ''))throw new Error('missing_comparable_text_price');
    const [n,f='']=s.split('.');
    return BigInt(n)*1000000n+BigInt(f.padEnd(6,'0'));
  }
  const pico=BigInt(inputTokens)*units(prices.Input)+BigInt(outputTokens)*units(prices.Output);
  return (pico/1000000000000n).toString()+'.'+(pico%1000000000000n).toString().padStart(12,'0');
}
