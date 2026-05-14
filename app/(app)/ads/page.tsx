import { createClient } from '@/lib/supabase/server';
import AdsClient from './AdsClient';

export default async function AdsPage() {
  const supabase = createClient();
  const { data } = await supabase.from('ads').select('*').order('date', { ascending: false });
  return <AdsClient initialAds={data || []} />;
}
