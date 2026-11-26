<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { BadgeCheck, FlaskConical, LoaderCircle, Play, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-vue-next';
import type { GeneratorInput, HoldKind, Route } from '../../../shared/types';
import { generateRoute, kindLabel, BASELINE_QUOTA } from '../lib/generateRoute';
import type { GenerationResult } from '../lib/generateRoute';
import { useRouteRegistry } from '../../wall/model/useRouteRegistry';
import { limbNames } from '../../limbs';

const emit = defineEmits<{ start: [id: string] }>();
const { upsertGenerated } = useRouteRegistry();

const form = reactive<GeneratorInput>({
  holdCount: 18,
  quota: { ...BASELINE_QUOTA },
  energy: 100,
  start: { x: 327.5, y: 496 },
  finish: { x: 372, y: 59 },
  seed: 20261126,
  proofLimitMs: 3000,
});
const generating = ref(false);
const result = ref<GenerationResult | null>(null);
const published = ref(false);

const quotaKinds: HoldKind[] = ['jug', 'edge', 'slope', 'step'];
const quotaTotal = computed(() => quotaKinds.reduce((sum, kind) => sum + form.quota[kind], 0));
const quotaMatches = computed(() => quotaTotal.value === form.holdCount);
const qualifiedRoute = computed<Route | null>(() => result.value?.publishable ? result.value.route : null);

function fmt(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function failureText(failure: string | null | undefined) {
  return failure === 'reach' ? '触及失败' : failure === 'support' ? '失衡' : failure === 'energy' ? '体力不足' : '全覆盖关闭';
}
function adjustCount(value: number) {
  const next = Math.max(18, Math.min(32, Math.round(value) || 18));
  const diff = next - quotaTotal.value;
  form.holdCount = next;
  form.quota.jug = Math.max(BASELINE_QUOTA.jug, form.quota.jug + diff);
}
function balanceQuota() {
  (Object.keys(form.quota) as HoldKind[]).forEach(kind => { form.quota[kind] = BASELINE_QUOTA[kind]; });
  form.quota.jug += form.holdCount - 18;
}
function resetDefaults() {
  Object.assign(form, {
    holdCount: 18, energy: 100, seed: 20261126, proofLimitMs: 3000,
    start: { x: 327.5, y: 496 }, finish: { x: 372, y: 59 },
  });
  form.quota = { ...BASELINE_QUOTA };
  result.value = null;
  published.value = false;
}

async function generate() {
  if (generating.value) return;
  generating.value = true;
  published.value = false;
  // Let the loading state paint before the synchronous exhaustive search.
  await new Promise(resolve => window.setTimeout(resolve, 40));
  try {
    const input: GeneratorInput = JSON.parse(JSON.stringify(form));
    const generation = generateRoute(input);
    result.value = generation;
    if (generation.publishable && generation.route) published.value = upsertGenerated(generation.route);
  } finally {
    generating.value = false;
  }
}

function challenge() {
  if (qualifiedRoute.value) emit('start', qualifiedRoute.value.id);
}

onMounted(() => { void generate(); });
</script>

<template>
  <section class="generator-studio" aria-label="误导路线生成器">
    <form class="generator-form" @submit.prevent="generate">
      <div class="generator-title">
        <span class="generator-icon"><FlaskConical :size="22" /></span>
        <div><h2>误导抱石蓝图生成器</h2><p>四点接触状态搜索 · 换脚顺序 · 体力预算穷尽证明</p></div>
      </div>

      <div class="generator-grid">
        <label class="field"><span>岩点总数</span>
          <input type="number" min="18" max="32" :value="form.holdCount" @input="adjustCount(Number(($event.target as HTMLInputElement).value))" />
          <small>可证明蓝图下限 18</small>
        </label>
        <label class="field"><span>全程体力上限</span>
          <input v-model.number="form.energy" type="number" min="20" max="240" step="5" />
          <small>成本按 {{ form.energy / 50 }}× 蓝图缩放</small>
        </label>
        <label class="field"><span>随机种子</span>
          <input v-model.number="form.seed" type="number" />
        </label>
        <label class="field"><span>证明时限 (ms)</span>
          <input v-model.number="form.proofLimitMs" type="number" min="300" max="10000" step="100" />
        </label>

        <div class="quota-box">
          <div class="quota-head"><b>材质 / 类型配额</b><span :class="{ invalid: !quotaMatches }">{{ quotaTotal }} / {{ form.holdCount }}</span></div>
          <div class="quota-grid">
            <label v-for="kind in quotaKinds" :key="kind" class="quota-field">
              <span>{{ kindLabel(kind) }}<em>≥{{ BASELINE_QUOTA[kind] }}</em></span>
              <input v-model.number="form.quota[kind]" type="number" :min="BASELINE_QUOTA[kind]" />
            </label>
          </div>
          <button type="button" class="text-button" @click="balanceQuota">按总数把额外点配平到把手点</button>
        </div>

        <div class="endpoint-box">
          <b>起点：四点接触组 / 终点：16 号顶点点位</b>
          <span class="endpoint-ids">LH=03 · RH=04 · LF=01 · RF=02；下方坐标指定脚点中心与 16 号点。</span>
          <div class="endpoint-grid">
            <label>起 X<input v-model.number="form.start.x" type="number" min="60" max="660" step="0.5" /></label>
            <label>起 Y<input v-model.number="form.start.y" type="number" min="450" max="525" step="1" /></label>
            <label>终 X<input v-model.number="form.finish.x" type="number" min="80" max="650" step="1" /></label>
            <label>终 Y<input v-model.number="form.finish.y" type="number" min="35" max="130" step="1" /></label>
          </div>
          <small>默认坐标已验证；大幅移动可能被证明器判为不合格。</small>
        </div>
      </div>

      <div class="generator-actions">
        <button class="generate-button" type="submit" :disabled="generating || !quotaMatches">
          <LoaderCircle v-if="generating" class="spin" :size="18" />
          <Sparkles v-else :size="18" />
          {{ generating ? '正在穷尽所有合法换点…' : '生成并做合格证明' }}
        </button>
        <button class="ghost-button" type="button" @click="resetDefaults">恢复默认</button>
        <span v-if="!quotaMatches" class="form-error">配额总和必须等于岩点总数</span>
      </div>
    </form>

    <div v-if="result" class="generation-result">
      <div v-if="result.publishable && qualifiedRoute?.certificate" class="certificate-banner qualified">
        <BadgeCheck :size="22" />
        <div><b>合格：三段动作证据已闭合，并已发布到路线列表</b>
          <span>尝试 {{ result.attempts }} 个候选 · 证明耗时 {{ result.elapsedMs }}ms · 实际配额 {{ Object.entries(qualifiedRoute.certificate.actualQuota).map(([k,v]) => `${kindLabel(k as HoldKind)}${v}`).join(' / ') }}</span>
        </div>
        <button class="challenge-button" type="button" @click="challenge"><Play :size="17" /> 直接开始挑战</button>
        <small v-if="!published" class="storage-note">浏览器存储不可用，本页可挑战但刷新后会消失</small>
      </div>
      <div v-else class="certificate-banner rejected">
        <ShieldAlert :size="22" />
        <div><b>未发布为合格路线</b><span>{{ result.errors.join('；') || '证明未闭合' }}</span></div>
      </div>

      <div v-if="qualifiedRoute?.certificate" class="order-notes">
        <span><b>四肢顺序证明：</b>搜索状态是 LH/RH/LF/RF 完整接触表与剩余体力的组合，而非手点连通图。</span>
        <span>A 线先 <code>LF→06</code>，再 <code>RF→17 / LF→19</code>；跳过 06 会使 LF19 超出脚点触及。</span>
        <span>B 线必须 <code>RF→18 → LF→17 → LF→19 → RF→20</code>；跳过换脚会在 RF20 触发 reach。</span>
        <span class="lure-note">诱导姿态后仍余 <b>{{ fmt(qualifiedRoute.certificate.lure.remaining) }}</b> 体力；不是提前力竭，而是所有预算内后续均不可登顶。</span>
      </div>

      <template v-if="qualifiedRoute?.certificate">
        <div class="evidence-grid">
          <article v-for="line in qualifiedRoute.certificate.lines" :key="line.id" class="evidence-card solution" :data-line="line.id">
            <header><span class="line-tag">{{ line.id }}</span><div><h3>{{ line.name }}</h3><small>中段组：{{ line.middleHolds.join('、') }}</small></div></header>
            <ol class="move-trail">
              <li v-for="(record, index) in line.moves" :key="index">
                <b>{{ index + 1 }}</b>
                <span>{{ limbNames[record.move.limb] }} → <code>{{ record.move.target }}</code></span>
                <em>−{{ fmt(record.cost) }} · 余 {{ fmt(record.energyAfter) }} · 撑 {{ record.landing.margin }}</em>
              </li>
            </ol>
            <footer>合计 {{ fmt(line.cost) }} 体力，登顶后余 {{ fmt(line.remaining) }}</footer>
          </article>

          <article class="evidence-card lure">
            <header><span class="line-tag lure-tag">诱</span><div><h3>{{ qualifiedRoute.certificate.lure.name }}</h3>
              <small>几步后站稳；到终点中心距离 {{ qualifiedRoute.certificate.lure.splitDistance }} → {{ qualifiedRoute.certificate.lure.closerDistance }}</small></div>
            </header>
            <ol class="move-trail">
              <li v-for="(record, index) in qualifiedRoute.certificate.lure.moves" :key="index">
                <b>{{ index + 1 }}</b>
                <span>{{ limbNames[record.move.limb] }} → <code>{{ record.move.target }}</code></span>
                <em>−{{ fmt(record.cost) }} · 余 {{ fmt(record.energyAfter) }} · 撑 {{ record.landing.margin }}</em>
              </li>
            </ol>
            <div class="proof-summary">
              <div><b>{{ qualifiedRoute.certificate.lure.proof.statesVisited }}</b><span>穷尽状态</span></div>
              <div :title="`共评估 ${qualifiedRoute.certificate.lure.proof.transitionsChecked} 个肢体×岩点动作`"><b>{{ qualifiedRoute.certificate.lure.proof.safeMovesChecked ?? qualifiedRoute.certificate.lure.proof.transitionsChecked }}</b><span>递归合法换点</span></div>
              <div><b>{{ qualifiedRoute.certificate.lure.proof.rootLegalMoves }}</b><span>诱导姿态根分支</span></div>
              <div><b :class="qualifiedRoute.certificate.lure.proof.complete ? 'ok' : 'bad'">{{ qualifiedRoute.certificate.lure.proof.complete ? '闭合' : '超时' }}</b><span>{{ qualifiedRoute.certificate.lure.proof.elapsedMs }}/{{ qualifiedRoute.certificate.lure.proof.limitMs }}ms</span></div>
            </div>
            <p class="proof-statement"><ShieldAlert :size="15" />
              下列每个根合法换点后的全部后续合法接触状态均已递归覆盖；没有任何分支能在剩余 {{ fmt(qualifiedRoute.certificate.lure.remaining) }} 体力内登顶。
            </p>
            <p class="blocked-line">其中 {{ qualifiedRoute.certificate.lure.proof.rootLegalMoves }} 个为可落定合法根换点，{{ qualifiedRoute.certificate.lure.proof.rootBlockedMoves ?? 0 }} 个根动作会立即因触及/支撑/体力失败而终止；滚动可查看完整根覆盖清单。</p>
            <div class="branch-coverage" tabindex="0" aria-label="诱导姿态所有直接合法换点的覆盖证明">
              <span v-for="branch in qualifiedRoute.certificate.lure.proof.rootBranches" :key="`${branch.limb}-${branch.target}`"
                class="branch-chip" :class="{ closed: branch.closed, open: branch.canFinish, incomplete: !branch.complete }">
                {{ limbNames[branch.limb] }}→{{ branch.target }} · −{{ fmt(branch.cost) }} · e{{ fmt(branch.energyAfter) }} · {{ branch.closed ? failureText(branch.failure) : branch.canFinish ? '可完攀' : '未证明' }}
              </span>
            </div>
          </article>
        </div>
      </template>

      <div v-else-if="result.route?.certificate" class="draft-evidence">
        <p><TriangleAlert :size="16" /> 已生成草稿，但证明状态为 {{ result.route.certificate.lure.proof.complete ? '发现完攀分支' : '未完成/超时' }}；开始按钮保持禁用。</p>
      </div>
    </div>
  </section>
</template>
