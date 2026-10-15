import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * E-mail transacional (hoje só a redefinição de senha).
 *
 * Sem SMTP_URL configurado o serviço não quebra: registra no log e informa
 * que não enviou, para o chamador decidir o que fazer — a tela do admin,
 * por exemplo, mostra o link para ser passado à pessoa por outro canal.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('SMTP_URL');
    this.from = config.get<string>('MAIL_FROM') ?? 'Transppass PCM <no-reply@transppass.online>';
    this.transport = url ? createTransport(url) : null;
  }

  get isConfigured(): boolean {
    return this.transport !== null;
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transport) {
      this.log.warn(`SMTP não configurado — e-mail para ${to} não enviado (${subject})`);
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text });
      return true;
    } catch (err) {
      this.log.error(`Falha ao enviar para ${to}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
