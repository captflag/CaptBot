import { ChartColumn } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['#8B5CF6', '#0EA5E9', '#10B981'];

/** Renders a JSON array from an answer (e.g. [{"year": 2024, "revenue": 12}]) as a bar chart. */
export default function ChartBlock({ data }: { data: Record<string, unknown>[] }) {
  const keys = Object.keys(data[0]);
  const x = keys.find((k) => typeof data[0][k] !== 'number') ?? keys[0];
  const series = keys.filter((k) => k !== x && typeof data[0][k] === 'number').slice(0, 3);
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0a0a0a]">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">
        <ChartColumn size={14} className="text-violet-500" /> Chart from answer data
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#9CA3AF" opacity={0.25} />
            <XAxis dataKey={x} stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6', borderRadius: 8 }} />
            {series.length > 1 && <Legend />}
            {series.map((key, i) => (
              <Bar key={key} dataKey={key} fill={COLORS[i]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
