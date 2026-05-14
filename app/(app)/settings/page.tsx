import { createClient } from '@/lib/supabase/server';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const supabase = createClient();
  const { data } = await supabase.from('settings').select('*').single();
  return <SettingsClient initialSettings={data || { rev_rule: 'shipping' }} />;
}
