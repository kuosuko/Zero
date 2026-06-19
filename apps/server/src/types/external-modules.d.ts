// nodemailer 與 mailparser 未隨套件提供型別宣告 (無 @types 安裝)。
// 以 ambient 宣告消除 TS7016 implicit-any 報錯；如需嚴格型別可改裝 @types/nodemailer + @types/mailparser。
declare module 'mailparser';
declare module 'nodemailer';
declare module 'nodemailer/lib/mailer' {
  export interface Address {
    name?: string;
    address: string;
  }
  const Mailer: unknown;
  export default Mailer;
}
