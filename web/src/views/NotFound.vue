<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();
</script>

<template>
  <h2 class="title">页面不存在</h2>
  <p class="muted">无法识别的路径 <code>{{ route.fullPath }}</code>。</p>
  <p><RouterLink to="/">← 回到单位图鉴</RouterLink></p>
</template>
