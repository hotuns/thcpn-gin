import { useSearchParams } from "react-router-dom";
import { Mail, Phone, UserRound } from "lucide-react";
import { commonStatusLabel } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { Badge, CopyId, PageHeader, Panel } from "@thcpn/ui";
import { SecurityTab } from "./security-tab";

const formatTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(input))
    : "—";

export function AccountPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "security" ? "security" : "profile";
  return (
    <>
      <PageHeader
        eyebrow="账户"
        title="账户中心"
        description="查看个人身份资料并管理登录安全。"
      />
      <div className="settings-tabs account-tabs">
        <button
          type="button"
          className={tab === "profile" ? "active" : ""}
          onClick={() => setParams({ tab: "profile" })}
        >
          账户资料
        </button>
        <button
          type="button"
          className={tab === "security" ? "active" : ""}
          onClick={() => setParams({ tab: "security" })}
        >
          账号安全
        </button>
      </div>
      {tab === "security" ? <SecurityTab /> : <AccountProfile />}
    </>
  );
}

function AccountProfile() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Panel className="account-profile-panel">
      <div className="account-profile-hero">
        <div className="account-profile-avatar">
          <UserRound size={24} aria-hidden="true" />
        </div>
        <div>
          <h2>{user.name}</h2>
          <p>{user.email ?? user.phone ?? "未设置联系方式"}</p>
        </div>
        <Badge tone={user.status === "active" ? "success" : "warning"}>
          {commonStatusLabel(user.status)}
        </Badge>
      </div>
      <div className="account-profile-grid">
        <div>
          <span>邮箱</span>
          <strong>
            <Mail size={14} aria-hidden="true" />
            {user.email ?? "未设置"}
          </strong>
          <small>{user.email_verified_at ? "已验证" : "未验证"}</small>
        </div>
        <div>
          <span>手机号</span>
          <strong>
            <Phone size={14} aria-hidden="true" />
            {user.phone ?? "未设置"}
          </strong>
          <small>{user.phone_verified_at ? "已验证" : "未验证"}</small>
        </div>
        <div>
          <span>最近登录</span>
          <strong>{formatTime(user.last_login_at)}</strong>
        </div>
        <div>
          <span>用户 ID</span>
          <strong>
            <CopyId value={user.id} />
          </strong>
        </div>
      </div>
    </Panel>
  );
}
