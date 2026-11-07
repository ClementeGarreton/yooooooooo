'use client'

import { useState } from 'react'
import { MessageCircle, X, Send } from 'lucide-react'
import Button from './Button'
import Card from './Card'

const faqs = [
  {
    question: '¿Cómo se calcula el precio?',
    answer: 'El precio se calcula en base al volumen de tus items, distancia, piso, y servicios adicionales que selecciones.',
  },
  {
    question: '¿Qué incluye el servicio?',
    answer: 'El servicio incluye transporte, carga y descarga. Los servicios de embalaje, desarme y armado son opcionales.',
  },
  {
    question: '¿Cuánto tiempo demora?',
    answer: 'Una mudanza promedio toma entre 3-6 horas dependiendo del volumen y la distancia.',
  },
  {
    question: '¿Tienen seguro?',
    answer: 'Sí, todos nuestros servicios cuentan con seguro de transporte de mercancías.',
  },
]

export default function ChatBot() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<{ text: string; isUser: boolean }[]>([
    { text: '¡Hola! ¿En qué puedo ayudarte? Puedes preguntarme sobre nuestros servicios.', isUser: false },
  ])
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (!input.trim()) return

    const userMessage = { text: input, isUser: true }
    setMessages([...messages, userMessage])

    // Respuesta simulada
    setTimeout(() => {
      const response = faqs.find((faq) =>
        input.toLowerCase().includes(faq.question.toLowerCase().split(' ')[0])
      )
      const botMessage = {
        text: response?.answer || 'Gracias por tu pregunta. Un agente te contactará pronto.',
        isUser: false,
      }
      setMessages((prev) => [...prev, botMessage])
    }, 1000)

    setInput('')
  }

  return (
    <>
      {/* Botón flotante */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 bg-primary-600 text-white p-4 rounded-full shadow-lg hover:bg-primary-700 transition-all hover:scale-110 z-50"
          aria-label="Abrir chat de ayuda"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Ventana de chat */}
      {isOpen && (
        <Card className="fixed bottom-6 right-6 w-96 h-[500px] flex flex-col z-50 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold">Asistente Virtual</h3>
                <p className="text-xs text-gray-500">En línea</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto mb-4 space-y-3">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-lg ${
                    message.isUser
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <p className="text-sm">{message.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* FAQs rápidas */}
          <div className="mb-3 flex flex-wrap gap-2">
            {faqs.slice(0, 2).map((faq, index) => (
              <button
                key={index}
                onClick={() => setInput(faq.question)}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-full transition-colors"
              >
                {faq.question}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Escribe tu pregunta..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <Button onClick={handleSend} size="sm" className="px-3">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}
    </>
  )
}

