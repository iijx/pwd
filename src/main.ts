import { createApp } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import "./style.css";
import App from "./App.vue";

const queryClient = new QueryClient();

createApp(App).use(VueQueryPlugin, { queryClient }).mount("#app");
